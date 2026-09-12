use std::{time::Instant, hint::black_box};
fn shuffle(input: &[u8], output: &mut [u8], delta: bool) {
 for lane in 0..8 { for row in 0..512 { let i=row*8+lane; output[lane*512+row]=if delta && row>0 { input[i].wrapping_sub(input[i-8]) } else { input[i] }; } }
}
fn unshuffle(input: &[u8], output: &mut [u8], delta: bool) {
 for lane in 0..8 { for row in 0..512 { let i=row*8+lane; output[i]=if delta && row>0 { input[lane*512+row].wrapping_add(output[i-8]) } else { input[lane*512+row] }; } }
}
fn main() {
 for file in std::env::args().skip(1) {
  let input=std::fs::read(&file).unwrap();
  for mode in 0..3 {
   let mut transformed=[0u8;4096];let start=Instant::now();
   let pages:Vec<_>=input.chunks_exact(4096).map(|raw| { if mode>0 {shuffle(raw,&mut transformed,mode==2);lz4_flex::block::compress(&transformed)}else{lz4_flex::block::compress(raw)} }).collect();
   let compression=start.elapsed().as_secs_f64();let compressed:usize=pages.iter().map(Vec::len).sum();
   let start=Instant::now();let mut out=[0u8;4096];
   for _ in 0..100 { for(encoded,raw)in pages.iter().zip(input.chunks_exact(4096)) {
    if mode>0 {assert_eq!(lz4_flex::block::decompress_into(encoded,&mut transformed).unwrap(),4096);unshuffle(&transformed,&mut out,mode==2);}
    else{assert_eq!(lz4_flex::block::decompress_into(encoded,&mut out).unwrap(),4096);}
    assert_eq!(out.as_slice(),raw);black_box(&out);
   }}
   let decompression=start.elapsed().as_secs_f64()/100.0;
   println!("{} mode={} raw={} compressed={} ratio={:.2} encodeMiBs={:.1} decodeMiBs={:.1}",file,mode,input.len(),compressed,input.len()as f64/compressed as f64,input.len()as f64/1048576.0/compression,input.len()as f64/1048576.0/decompression);
  }
 }
}
