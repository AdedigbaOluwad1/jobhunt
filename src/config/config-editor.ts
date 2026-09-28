import * as fs from 'node:fs';
import * as YAML from 'yaml';
import { AppError } from '../common/errors';
import { configPath } from '../common/paths';

const ARRAY_SOURCES = ['greenhouse', 'lever', 'lever_eu', 'ashby'] as const;
export type ArraySource = (typeof ARRAY_SOURCES)[number];

export function isArraySource(source: string): source is ArraySource {
  return (ARRAY_SOURCES as readonly string[]).includes(source);
}

function loadDocument(): YAML.Document {
  const path = configPath();
  if (!fs.existsSync(path)) {
    throw new AppError('CONFIG_MISSING', `config.yaml not found at ${path}. Run \`jobhunt init\` first.`);
  }
  return YAML.parseDocument(fs.readFileSync(path, 'utf8'));
}

function saveDocument(doc: YAML.Document): void {
  fs.writeFileSync(configPath(), doc.toString());
}

function scalarValue(item: unknown): unknown {
  return YAML.isScalar(item) ? item.value : item;
}

function getSourceSeq(doc: YAML.Document, source: ArraySource): YAML.YAMLSeq {
  const seq = doc.getIn(['sources', source], true);
  if (seq === undefined) {
    doc.setIn(['sources', source], doc.createNode([]));
    return doc.getIn(['sources', source], true) as YAML.YAMLSeq;
  }
  if (!YAML.isSeq(seq)) {
    throw new AppError('CONFIG_INVALID', `sources.${source} is not a list in config.yaml`);
  }
  return seq;
}

export function addSourceTarget(source: ArraySource, board: string): { alreadyExists: boolean } {
  const doc = loadDocument();
  const seq = getSourceSeq(doc, source);
  if (seq.items.some((item) => scalarValue(item) === board)) {
    return { alreadyExists: true };
  }
  doc.addIn(['sources', source], board);
  saveDocument(doc);
  return { alreadyExists: false };
}

export function removeSourceTarget(source: ArraySource, board: string): { removed: boolean } {
  const doc = loadDocument();
  const seq = getSourceSeq(doc, source);
  const idx = seq.items.findIndex((item) => scalarValue(item) === board);
  if (idx === -1) return { removed: false };
  seq.items.splice(idx, 1);
  saveDocument(doc);
  return { removed: true };
}
