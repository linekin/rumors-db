import { compareTwoStrings } from 'string-similarity';
import path from 'path';
import { readFileSync, writeFile } from 'fs';
import SimHash from 'simhash';
import readline from 'readline';
import sha1 from 'sha1';

const simhash = SimHash();

function sanitize(str) {
  return str
    // URL -> hash
    .replace(/(\b(https?|ftp):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/gim, (match, p1) => `URL[${sha1(p1)}]`)

    // non-content words
    .replace(/[\n\r ,.!()~:;"'“”，。！（）～：；「」『』]/g, '');
}

function toBigram(str) {
  const length = str.length;
  return str.split('').reduce((bigram, word, i, arr) => {
    if (i === length - 1) return bigram;
    return bigram.concat(word + arr[i + 1]);
  }, []);
}

function toSimHash(str) {
  const grams = toBigram(sanitize(str));
  return simhash(grams);
}

function hammingDistance(bits1, bits2, maxDist = 10) {
  let dist = 0;
  for (let i = 0; i < bits1.length && dist <= maxDist; i += 1) {
    if (bits1[i] !== bits2[i]) dist += 1;
  }

  return dist;
}

const memoizationMapFileName = path.join(__dirname, 'resolveSimilarity.json');
let askSimilarityMemoization;

try {
  askSimilarityMemoization = JSON.parse(
    readFileSync(memoizationMapFileName, 'utf8'),
  );
} catch (e) {
  console.error('resolveSimilarity.json not found, initialize new memoization map...');
  askSimilarityMemoization = {};
}

function askSimilarity(doc1, doc2, similarity) {
  const memoizationKey = `${sha1(doc1)}|${sha1(doc2)}`;
  if (typeof askSimilarityMemoization[memoizationKey] !== 'undefined') {
    return Promise.resolve(askSimilarityMemoization[memoizationKey].value);
  }

  return new Promise((resolve) => {
    console.log('\n======================================\n');
    console.log(doc1);
    console.log(`\n ^^^^^^^^ Similarty = ${similarity.toFixed(4)} vvvvvvvv\n`);
    console.log(doc2);
    console.log('\n======================================\n');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Are these 2 documents the same? (y/N)', (ans) => {
      if (ans === 'y') resolve(true);
      else resolve(false);
      rl.close();
    });
  }).then((value) => {
    askSimilarityMemoization[memoizationKey] = {
      value, doc1, doc2,
    };
    // Write to json, but don't care about callback
    writeFile(memoizationMapFileName, JSON.stringify(askSimilarityMemoization, null, '  '));
    return value;
  });
}

export default class DistanceDB {
  constructor(safeSimilarity, minSimilarity) {
    this._safeSimilarity = safeSimilarity;
    this._minSimiarity = minSimilarity;

    // Overlapping bins, which will apply different hamming distance threshold,
    // as simhash is sensitive to document length.
    // http://www.lanceyan.com/tech/arch/simhash_hamming_distance_similarity.html
    //
    // an entry = {hash: hashed text for index, sanitizedText, text, payload}
    //
    this._shortEntries = []; // < 100 words
    this._shortEntries._minHashDistThres = 12; // bits
    this._mediumEntries = []; // 80 ~ 200 words
    this._mediumEntries._minHashDistThres = 8; // bits
    this._longEntries = []; // 150+ words
    this._longEntries._minHashDistThres = 4; // bits

    this.payloads = []; // all added payloads
  }

  _findDuplicateEntriesAndSimilarities(text, entries) {
    const hash = toSimHash(text);
    const maxDist = entries._minHashDistThres;
    const candidates = entries.filter(
      entry => hammingDistance(entry.hash, hash, maxDist) <= maxDist,
    );

    const sanitizedText = sanitize(text);
    // console.log(`${candidates.length} / ${entries.length} entires are being scanned...`);

    return candidates.map(entry => ({
      similarity: compareTwoStrings(sanitizedText, entry.sanitizedText),
      entry,
    })).filter(({ similarity }) => similarity > this._minSimiarity);
  }

  _binsToCheck(sanitizedTextLength) {
    const bins = [];
    if (sanitizedTextLength < 100) bins.push(this._shortEntries);
    if (sanitizedTextLength > 80 && sanitizedTextLength < 200) bins.push(this._mediumEntries);
    if (sanitizedTextLength > 150) bins.push(this._longEntries);
    return bins;
  }

  async findDuplication(text) {
    let bestSimilarity = this._minSimiarity;
    let bestMatchEntry = null;

    this._binsToCheck(sanitize(text).length).forEach((bin) => {
      this._findDuplicateEntriesAndSimilarities(text, bin).forEach(({ entry, similarity }) => {
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatchEntry = entry;
        }
      });
    });

    if (!bestMatchEntry) return null;

    if (bestSimilarity > this._safeSimilarity) return bestMatchEntry.payload;

    return (await askSimilarity(bestMatchEntry.text, text, bestSimilarity)) ?
      bestMatchEntry.payload :
      null;
  }

  add(textToIndex, payload) {
    const sanitizedText = sanitize(textToIndex);

    const entry = {
      text: textToIndex,
      hash: toSimHash(textToIndex),
      sanitizedText,
      payload,
    };

    this._binsToCheck(sanitizedText.length).forEach(bin => bin.push(entry));
    this.payloads.push(payload);
  }
}
