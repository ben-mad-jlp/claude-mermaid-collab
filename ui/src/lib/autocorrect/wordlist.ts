export const COMMON_TYPOS: Record<string, string> = {
  teh: 'the',
  recieve: 'receive',
  adn: 'and',
  hte: 'the',
  taht: 'that',
  wtih: 'with',
  seperate: 'separate',
  definately: 'definitely',
  occured: 'occurred',
  thier: 'their',
  wich: 'which',
  becuase: 'because',
  wierd: 'weird',
  freind: 'friend',
  beleive: 'believe',
  arguement: 'argument',
  enviroment: 'environment',
  goverment: 'government',
  neccessary: 'necessary',
  accross: 'across',
  untill: 'until',
  accomodate: 'accommodate',
  occassion: 'occasion',
  recomend: 'recommend',
  writting: 'writing',
  begining: 'beginning',
  supose: 'suppose',
  oportunity: 'opportunity',
  administation: 'administration',
  adress: 'address',
  acheive: 'achieve',
  existance: 'existence',
  dissappoint: 'disappoint',
  foregin: 'foreign',
  refference: 'reference',
  alot: 'a lot',
  aquire: 'acquire',
  enought: 'enough',
  dosen: 'dozen',
  sincerly: 'sincerely',
  commited: 'committed',
  existnece: 'existence',
  buisness: 'business',
  succesful: 'successful',
  havent: 'have not',
  shouldnt: 'should not',
  couldnt: 'could not',
  wouldnt: 'would not',
  didnt: 'did not',
  doesnt: 'does not',
  im: 'I am',
  thats: 'that is',
};

// Valid English words that must NEVER appear as COMMON_TYPOS keys — adding one would
// rewrite correct input. The disjointness is asserted in wordlist.test.ts (fails CI).
export const PROTECTED_VALID_WORDS: string[] = [
  'your', 'its', 'were', 'well', 'id', 'ill', 'cant', 'wont',
  'hell', 'dont', 'hes', 'shes', 'weve',
];

export async function loadCommonWords(): Promise<Set<string>> {
  const mod = await import('./common-words-en.json');
  const words = (mod.default as string[]).map((w) => w.toLowerCase());
  return new Set(words);
}
