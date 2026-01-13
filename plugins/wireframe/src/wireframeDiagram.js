/**
 * Main wireframe diagram module
 * Ties together parser, db, renderer, and styles
 */

import { parser as jisonParser } from './parser/wireframeParser.js';
import * as db from './wireframeDb.js';
import renderer from './wireframeRenderer.js';
import styles from './styles.js';

// Wrap the Jison parser in the structure Mermaid expects
const parser = {
  parser: jisonParser,
  parse: (text) => {
    const result = jisonParser.parse(text);
    db.addNodes(result);
    return result;
  }
};

export const diagram = {
  parser,
  db,
  renderer,
  styles,

  init: (config) => {
    db.clear();
  }
};
