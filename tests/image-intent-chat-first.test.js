import test from 'node:test';
import assert from 'node:assert/strict';
import { imageIntent } from '../public/image-intent.js';

test('chat prompt generates images without opening the Alat mode first', () => {
 for(const prompt of [
  'Buat poster promo top up game', 'Bikinkan logo modern untuk BOR AI',
  'Desain banner diskon akhir pekan', 'generate a picture of a sunset',
  'create a logo for my cafe', 'Draw a cat wearing a spacesuit',
  'Lukiskan pemandangan gunung', 'Buat ilustrasi cerita rakyat'
 ]) assert.equal(imageIntent(prompt), 'generate', prompt);
});

test('an uploaded photo plus a transformation prompt selects edit automatically',()=>{
 for(const prompt of [
  'Jadikan foto ini bergaya anime', 'Ganti background jadi pantai',
  'Hapus orang di belakang', 'Ubah warna baju jadi merah',
  'Edit foto ini agar lebih terang', 'Buat poster promo dari foto ini',
  'Tambahkan tulisan diskon 50% ke gambar', 'Remove the background',
  'Enhance and sharpen this photo'
 ]) assert.equal(imageIntent(prompt,true), 'edit',prompt);
});

test('image questions, tutorials and textual writing never trigger a paid image job',()=>{
 for(const prompt of [
   'Jelaskan isi gambar ini', 'Bagaimana cara membuat poster?',
   'Buat caption untuk foto ini', 'Buatkan prompt untuk gambar anime',
   'Analisis objek di foto ini', 'What is in this photo?',
   'Bantu saya mempelajari desain poster',
   'Baca teks yang ada di gambar ini'
 ]) {
   assert.equal(imageIntent(prompt),null,prompt);
   assert.equal(imageIntent(prompt,true),null,prompt);
 }
});

test('no attached source means an edit request is not silently treated as generation',()=>{
 assert.equal(imageIntent('Hapus background foto ini',false),'edit');
 assert.equal(imageIntent('Ganti warna gambar ini',false),'edit');
 assert.equal(imageIntent('Ganti background jadi hutan',false),'edit');
 assert.equal(imageIntent('Tolong jawab pertanyaanku',false),null);
});
test('explicit tool modes override ambiguous natural language',()=>{
 assert.equal(imageIntent('Ganti background',true,'chat'),null);
 assert.equal(imageIntent('Jelaskan foto ini',true,'analyze'),null);
 assert.equal(imageIntent('Jelaskan foto ini',true,'edit'),'edit');
 assert.equal(imageIntent('Buat poster',true,'generate'),'generate');
});
