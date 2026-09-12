//! Browser execution stays on one worker. Keep the iterator operations direct
//! instead of scheduling Rayon jobs through function pointers before page faults.
pub trait IntoParallelIterator: IntoIterator + Sized {
    fn into_par_iter(self) -> Self::IntoIter { self.into_iter() }
}
impl<T: IntoIterator> IntoParallelIterator for T {}

pub trait ParallelIterator: Iterator + Sized {
    fn with_max_len(self, _: usize) -> Self { self }
    fn map_init<S, R>(self, init: impl FnOnce() -> S, mut map: impl FnMut(&mut S, Self::Item) -> R) -> impl Iterator<Item = R> {
        let mut state = init();
        self.map(move |value| map(&mut state, value))
    }
}
impl<T: Iterator> ParallelIterator for T {}

pub trait ParallelSlice<T> {
    fn par_iter(&self) -> std::slice::Iter<'_, T>;
    fn par_iter_mut(&mut self) -> std::slice::IterMut<'_, T>;
    fn par_sort_unstable_by_key<K: Ord>(&mut self, key: impl FnMut(&T) -> K);
}
impl<T> ParallelSlice<T> for [T] {
    fn par_iter(&self) -> std::slice::Iter<'_, T> { self.iter() }
    fn par_iter_mut(&mut self) -> std::slice::IterMut<'_, T> { self.iter_mut() }
    fn par_sort_unstable_by_key<K: Ord>(&mut self, key: impl FnMut(&T) -> K) { self.sort_unstable_by_key(key); }
}
