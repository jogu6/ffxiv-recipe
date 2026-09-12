use std::sync::Mutex;
use crate::memory::{SharedStore, PagedVec, Record};

use raphael_sim::{Effects, SimulationState};
#[cfg(any(not(target_arch = "wasm32"), feature = "parallel"))]
use rayon::prelude::*;
#[cfg(all(target_arch = "wasm32", not(feature = "parallel")))]
use crate::sequential::*;
use rustc_hash::FxHashMap;

// It is important that this mask doesn't use any effect to its full bit range.
// Otherwise, `Value::effect_dominates` will break.
const EFFECTS_VALUE_MASK: u64 = Effects::new()
    .with_inner_quiet(1)
    .with_manipulation(3)
    .with_waste_not(3)
    .with_great_strides(1)
    .with_veneration(3)
    .with_innovation(3)
    .into_bits();

const EFFECTS_KEY_MASK: u64 = !EFFECTS_VALUE_MASK;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Key {
    progress: u16,
    effects: u64,
}

impl From<&SimulationState> for Key {
    fn from(state: &SimulationState) -> Self {
        Self {
            progress: state.progress,
            effects: state.effects.into_bits() & EFFECTS_KEY_MASK,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Value(wide::u32x4);

impl Value {
    /// Guard value for Pareto-dominance check.
    /// Value A dominates B is subtracting B from A leaves the guard bits unchanged.
    const GUARD: wide::u32x4 = {
        // The effect bits used for comparison are truncated to 32 bits to make
        // everything fit into a 128-bit SIMD value.
        // The asserts make sure that no information is lost when truncating.
        assert!(EFFECTS_KEY_MASK >> 32 == 0xffffffff);
        assert!(EFFECTS_VALUE_MASK >> 32 == 0x00000000);
        wide::u32x4::new([
            0x80008000,              // CP and Durability
            0x80000000,              // Quality
            0x80000000,              // Unreliable quality
            EFFECTS_KEY_MASK as u32, // Effects
        ])
    };

    /// `A` dominates `B` if every member of `A` is geq the corresponding member in `B`.
    fn dominates(&self, other: &Self) -> bool {
        let guarded_value = Self::GUARD | self.0;
        (guarded_value - other.0) & Self::GUARD == Self::GUARD
    }

    fn cp(&self) -> u16 {
        (self.0.as_array()[0] >> 16) as u16
    }
}

impl From<&SimulationState> for Value {
    fn from(state: &SimulationState) -> Self {
        Self(wide::u32x4::new([
            (u32::from(state.cp) << 16) + u32::from(state.durability),
            u32::from(state.quality),
            u32::from(state.quality) + u32::from(state.unreliable_quality),
            (state.effects.into_bits() & EFFECTS_VALUE_MASK) as u32,
        ]))
    }
}

impl Record for Value {
    const BYTES: usize = 16;
    fn encode(self, target: &mut [u8]) {
        for (index, value) in self.0.as_array().iter().enumerate() {
            target[index * 4..index * 4 + 4].copy_from_slice(&value.to_le_bytes());
        }
    }
    fn decode(source: &[u8]) -> Self {
        Self(wide::u32x4::new(std::array::from_fn(|index|
            u32::from_le_bytes(source[index * 4..index * 4 + 4].try_into().unwrap()))))
    }
}

struct IntermediateNode {
    partition_point: u16,
    lhs: Box<TreeNode>,
    rhs: Box<TreeNode>,
}

struct LeafNode {
    range_min: u16,
    range_max: u16,
    values: PagedVec<Value>,
}

enum TreeNode {
    Intermediate(IntermediateNode),
    Leaf(LeafNode),
}

impl TreeNode {
    fn new(store: SharedStore) -> Self {
        Self::Leaf(LeafNode {
            range_min: u16::MIN,
            range_max: u16::MAX,
            values: PagedVec::new(store),
        })
    }
}

pub struct ParetoFront {
    store: SharedStore,
    buckets: FxHashMap<Key, Mutex<TreeNode>>,
}

impl ParetoFront {
    pub fn new(store: SharedStore) -> Self { Self { store, buckets: FxHashMap::default() } }
    pub fn allocated_bytes(&self) -> usize {
        fn tree_bytes(node: &TreeNode) -> usize {
            match node {
                TreeNode::Leaf(leaf) => leaf.values.capacity() * std::mem::size_of::<Value>(),
                TreeNode::Intermediate(branch) => 2 * std::mem::size_of::<TreeNode>()
                    + tree_bytes(&branch.lhs) + tree_bytes(&branch.rhs),
            }
        }
        self.buckets.capacity() * std::mem::size_of::<(Key, Mutex<TreeNode>)>()
            + self.buckets.values().map(|node| tree_bytes(&node.lock().unwrap())).sum::<usize>()
    }
    /// Inserts all non-dominated elements into the pareto front while also removing dominated values
    /// from the pareto front. Returns an iterator over elements that were inserted.
    pub fn insert_batch<T: Clone + Send + Sync>(
        &mut self,
        mut elements: Vec<T>,
        to_state: impl Fn(&T) -> &SimulationState + Sync,
    ) -> impl Iterator<Item = T> {
        // Group elements by their key to avoid contention in the hashmap.
        let elements_by_key: Vec<(Key, &[T])> = {
            let mut result = Vec::new();
            elements.par_sort_unstable_by_key(|element| Key::from(to_state(element)));
            let mut elements_slice = elements.as_slice();
            for idx in (1..elements_slice.len()).rev() {
                let lhs_key = Key::from(to_state(&elements_slice[idx - 1]));
                let rhs_key = Key::from(to_state(&elements_slice[idx]));
                if lhs_key != rhs_key {
                    let rhs_slice = elements_slice.split_off(idx..).unwrap();
                    self.store.lock().unwrap().reserve_vec(&mut result, 1);
                    result.push((rhs_key, rhs_slice));
                }
            }
            if !elements_slice.is_empty() {
                let key = Key::from(to_state(elements_slice.first().unwrap()));
                self.store.lock().unwrap().reserve_vec(&mut result, 1);
                result.push((key, elements_slice));
            }
            result
        };
        // Make sure all keys exist in the hashmap.
        let missing = elements_by_key.iter().filter(|(key, _)| !self.buckets.contains_key(key)).count();
        while self.buckets.try_reserve(missing).is_err() {
            assert!(self.store.lock().unwrap().recover_allocation() > 0, "比較用の索引メモリーを確保できません");
        }
        for (key, _elements) in &elements_by_key {
            self.buckets.entry(*key).or_insert_with(|| Mutex::new(TreeNode::new(self.store.clone())));
        }
        // Update pareto front and return non-dominated elements.
        let non_dominated_elements = elements_by_key
            .into_par_iter()
            .with_max_len(1)
            .map(|(key, elements)| {
                // Copy elements into own Vec to prevent false sharing.
                let mut copied = Vec::new();
                self.store.lock().unwrap().reserve_vec(&mut copied, elements.len());
                copied.extend_from_slice(elements);
                let mut elements = copied;
                // Sort elements in a way that ensures an element cannot be dominated
                // by another element that comes later in the list.
                elements.sort_unstable_by_key(|element| {
                    let state = to_state(element);
                    let weight = u64::from(state.cp)
                        + u64::from(state.durability)
                        + u64::from(state.quality)
                        + u64::from(state.unreliable_quality)
                        + state.effects.into_bits();
                    std::cmp::Reverse(weight)
                });
                let mut root_node = self.buckets.get(&key).unwrap().lock().unwrap();
                elements.retain(|element| Self::insert(to_state(element), &mut root_node));
                elements
            })
            .collect::<Vec<_>>();
        non_dominated_elements.into_iter().flatten()
    }

    fn insert(state: &SimulationState, mut node: &mut TreeNode) -> bool {
        const MAX_LEAF_SIZE: usize = 200;
        let new_value = Value::from(state);
        while let TreeNode::Intermediate(intermediate) = node {
            if new_value.cp() < intermediate.partition_point {
                node = intermediate.lhs.as_mut();
            } else {
                node = intermediate.rhs.as_mut();
            }
        }
        if let TreeNode::Leaf(leaf) = node {
            let mut values = leaf.values.to_vec();
            let is_dominated = values.iter().any(|value| value.dominates(&new_value));
            if !is_dominated {
                values.retain(|value| !new_value.dominates(value));
                leaf.values.store().lock().unwrap().reserve_vec(&mut values, 1);
                values.push(new_value);
                leaf.values.replace(&values);
            }
            if leaf.values.len() > MAX_LEAF_SIZE && leaf.range_min + 1 != leaf.range_max {
                values.sort_unstable_by_key(Value::cp);
                let (lhs_values, rhs_values) = values.split_at(MAX_LEAF_SIZE / 2);
                let store = leaf.values.store();
                let partition_point = rhs_values[0].cp();
                *node = TreeNode::Intermediate(IntermediateNode {
                    partition_point,
                    lhs: Box::new(TreeNode::Leaf(LeafNode {
                        range_min: leaf.range_min,
                        range_max: partition_point,
                        values: PagedVec::from_slice(store.clone(), lhs_values),
                    })),
                    rhs: Box::new(TreeNode::Leaf(LeafNode {
                        range_min: partition_point,
                        range_max: leaf.range_max,
                        values: PagedVec::from_slice(store.clone(), rhs_values),
                    })),
                });
            }
            !is_dominated
        } else {
            unreachable!()
        }
    }
}
