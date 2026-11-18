import { CStream, SaxHandler } from "./../libs/clarinet/cstream";
import { Readable, Stream } from "stream";
import {
  StreamingPathEngine,
  tokenizeJsonPath,
  buildLegacyAndDetermineEngine,
  LegacyParsedPath,
  PATH_ERROR_MESSAGE,
  PifferoJsonPathError,
} from "./jsonpathEngine";

export type PifferoOpt = "string" | "stream";

const OPEN_OBJECT = "object-open";
const CLOSE_OBJECT = "object-close";
const OPEN_ARRAY = "array-open";
const CLOSE_ARRAY = "array-close";
const VALUE = "value";
const KEY = "key";
const FIRST = "first";
export { PATH_ERROR_MESSAGE, PifferoJsonPathError };
export const PATH_DOESNT_MATCH = "Path doesn't match";
export class PifferoError extends Error {}

const STREAM_CHUNK_THRESHOLD = 4096;
const STRING_CHUNK_THRESHOLD = 16384;

type PifferoEvent =
  | typeof OPEN_OBJECT
  | typeof CLOSE_OBJECT
  | typeof OPEN_ARRAY
  | typeof CLOSE_ARRAY
  | typeof VALUE
  | typeof KEY
  | typeof FIRST;

export class PifferoStatus {
  //abbiamo verificato la condizione
  verified: boolean = false;
  // sto "registrando"
  recording: boolean = false;

  //sono in un array e cerco
  isInArray: boolean = false;
  // forse non serve arraay di primitivi
  isPrimitiveTypeArray = false;
  // la root è un array
  isRootArray = false;

  isMatching = false;

  waitingForArrayClosing = false;

  _needComma = false;

  _isBulkResponse = false;

  tempChunks: string[] = [];

  end: boolean = false;
  close: boolean = false;

  // conta a che livello sono sceso per aggiornare gli indici
  public depthCounter: number = 0;
  public needBracketes: boolean = false;
  currentIndex: number = -1;

  public last: PifferoEvent;

  lastkey: string;

  path: ParsedPath = undefined;

  constructor(path: ParsedPath, isBulk: boolean = false) {
    this.path = path;
    this._isBulkResponse = isBulk;
    if (this.path.range || path.condition) {
      this.isInArray = true;
      if (this.path.value === '"$"') {
        this.depthCounter = 1;
        this.isMatching = true;
      }
    } else if (this.path.value === '"$"') {
      if (!path.condition) {
        this.verified = true;
      }
      this.recording = true;
    }

    if (this.path.value !== '"$"') {
      this.last = FIRST;
    }
  }

  hasTemp(): boolean {
    return this.tempChunks.length > 0;
  }

  appendTemp(value: string) {
    this.tempChunks.push(value);
  }

  resetTemp(initial?: string) {
    this.tempChunks = initial !== undefined ? [initial] : [];
  }

  flushTemp(): string {
    if (this.tempChunks.length === 0) {
      return "";
    }
    const joined = this.tempChunks.join("");
    this.tempChunks = [];
    return joined;
  }

  get needComma(): boolean {
    return (
      this.last === CLOSE_ARRAY ||
      this.last === CLOSE_OBJECT ||
      this.last === VALUE ||
      this._needComma
    );
  }
  get isBulkResponse(): boolean {
    return this._isBulkResponse || this.path.isbulk || this.path.hascondtion;
  }

  checkIndex() {
    if (this.path.indexes && this.path.indexes.size > 0) {
      return this.path.indexes.has(this.currentIndex);
    }
    const range = this.path.range;
    const start =
      range.start !== undefined && range.start >= 0 ? range.start : 0;
    if (this.currentIndex < start) {
      return false;
    }
    if (range.end !== undefined && this.currentIndex >= range.end) {
      return false;
    }
    if (range.step !== undefined && range.step <= 0) {
      return false;
    }
    const step = range.step !== undefined ? range.step : 1;
    return (this.currentIndex - start) % step === 0;
  }
}

export class MasterHandler implements SaxHandler {
  handlerIndex = 0;
  stepHandlers: SingleStepHandler[] = [];
  currentHandler: SingleStepHandler;
  useString: boolean;
  skipDecode = false;
  cStream: CStream;
  callback: (result, error?) => void;
  error = null;
  stream: Readable;
  output: Readable;
  private streamingEngine: StreamingPathEngine = null;
  private engineClosed = false;
  private engineOutputChunks: string[] = ["["];
  private engineStringBuffer: string[] = [];
  private engineStringBufferLen = 0;
  private engineStreamBuffer: string[] = [];
  private engineStreamBufferLen = 0;

  parse(
    stream: Stream,
    parsedPath: ParsedPath,
    useString = false,
    callback?: (result, error?) => void,
    isBulk: boolean = false,
    options?: { resultType?: "value" | "path" | "pointer" | "all" }
  ): Stream {
    this.callback = callback;
    this.stream = stream as Readable;
    this.useString = useString;
    const resultType = (options && options.resultType) || "value";
    this.output = new Readable({
      read: () => {
        if (this.stream && this.stream.isPaused()) {
          this.stream.resume();
        }
      },
    });

    if (
      (parsedPath.needsStreamingEngine || resultType !== "value") &&
      parsedPath.steps
    ) {
      this.streamingEngine = new StreamingPathEngine(
        parsedPath.steps,
        (chunk: string) => this.pushEngineOutput(chunk),
        () => {
          this.cStream.destroy();
          this.stream.unpipe();
          this.stream.destroy();
        },
        resultType
      );
      this.streamingEngine.onend = () => this.onend();
      this.streamingEngine.onclose = () => this.onclose();
      this.streamingEngine.onerror = (er: any) => this.onerror(er);
      if (!useString) {
        this.output.push("[");
      }
      this.cStream = new CStream(this.streamingEngine);
      this.stream.pipe(this.cStream);
      if (!useString) {
        return this.output;
      }
      return;
    }

    const singleStepHandler = new SingleStepHandler(
      parsedPath,
      this.output,
      this.stream,
      useString,
      isBulk
    );

    this.stepHandlers.push(singleStepHandler);

    while (parsedPath.next && !parsedPath.hascondtion) {
      parsedPath = parsedPath.next;
      const stepHandler = new SingleStepHandler(
        parsedPath,
        this.output,
        this.stream,
        useString,
        isBulk
      );
      this.stepHandlers.push(stepHandler);
    }

    if (!useString) {
      this.output.push("[");
    }

    this.currentHandler = this.stepHandlers[this.handlerIndex];

    this.shiftParser();
    this.updateLegacySkipDecode();
    this.cStream = new CStream(this);
    this.stream.pipe(this.cStream);
    if (!useString) {
      return this.output;
    }
  }

  parseSync(
    data: string | Buffer | Uint8Array,
    parsedPath: ParsedPath,
    options?: { resultType?: "value" | "path" | "pointer" | "all" }
  ): string {
    let syncResult = "[]";
    let syncError: any = null;
    this.callback = (res, err) => {
      syncResult = res;
      syncError = err;
    };
    this.useString = true;
    const resultType = (options && options.resultType) || "value";
    const buf =
      typeof data === "string"
        ? Buffer.from(data, "utf8")
        : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

    if (
      (parsedPath.needsStreamingEngine || resultType !== "value") &&
      parsedPath.steps
    ) {
      this.streamingEngine = new StreamingPathEngine(
        parsedPath.steps,
        (chunk: string) => this.pushEngineOutput(chunk),
        () => {
          this.cStream.destroy();
        },
        resultType
      );
      this.streamingEngine.onend = () => this.onend();
      this.streamingEngine.onclose = () => this.onclose();
      this.streamingEngine.onerror = (er: any) => this.onerror(er);
      this.cStream = new CStream(this.streamingEngine);
    } else {
      const singleStepHandler = new SingleStepHandler(
        parsedPath,
        undefined,
        undefined,
        true,
        false
      );
      this.stepHandlers.push(singleStepHandler);
      while (parsedPath.next && !parsedPath.hascondtion) {
        parsedPath = parsedPath.next;
        const stepHandler = new SingleStepHandler(
          parsedPath,
          undefined,
          undefined,
          true,
          false
        );
        this.stepHandlers.push(stepHandler);
      }
      this.currentHandler = this.stepHandlers[this.handlerIndex];
      this.shiftParser();
      this.updateLegacySkipDecode();
      this.cStream = new CStream(this);
    }

    this.cStream.write(buf);
    this.cStream.end();

    if (syncError) {
      throw syncError;
    }
    return syncResult;
  }

  private pushEngineOutput(value: string) {
    if (this.useString) {
      this.engineStringBuffer.push(value);
      this.engineStringBufferLen += value.length;
      if (this.engineStringBufferLen >= STRING_CHUNK_THRESHOLD) {
        this.engineOutputChunks.push(this.engineStringBuffer.join(""));
        this.engineStringBuffer = [];
        this.engineStringBufferLen = 0;
      }
    } else {
      this.engineStreamBuffer.push(value);
      this.engineStreamBufferLen += value.length;
      if (this.engineStreamBufferLen >= STREAM_CHUNK_THRESHOLD) {
        this.flushEngineStreamBuffer();
      }
    }
  }

  private flushEngineStreamBuffer() {
    if (this.engineStreamBuffer.length > 0) {
      const chunk = this.engineStreamBuffer.join("");
      this.engineStreamBuffer = [];
      this.engineStreamBufferLen = 0;
      if (!this.output.push(chunk) && this.stream && !this.stream.isPaused()) {
        this.stream.pause();
      }
    }
  }

  private updateLegacySkipDecode() {
    if (this.currentHandler) {
      const st = this.currentHandler.status;
      this.skipDecode =
        !st.recording &&
        !st.path.hascondtion &&
        !st.path.condition &&
        st.depthCounter >= 3;
    } else {
      this.skipDecode = false;
    }
  }

  checkStreams() {
    if (this.streamingEngine) {
      return;
    }
    if (this.currentHandler.status.end && this.currentHandler.isLast) {
      this.cStream.destroy();
      if (this.stream) {
        this.stream.unpipe();
        this.stream.destroy();
      }
    }
  }

  shiftParser() {
    if (this.streamingEngine) {
      return;
    }
    if (!this.currentHandler.isLast && this.currentHandler.status.recording) {
      let last = this.currentHandler.status.last;
      const lastkey = this.currentHandler.status.lastkey;
      let depthCounter = 0;
      if (this.currentHandler.status.last === OPEN_OBJECT) {
        depthCounter = 1;
        last = FIRST;
      }
      this.handlerIndex++;
      this.currentHandler = this.stepHandlers[this.handlerIndex];
      this.currentHandler.status.last = last;
      this.currentHandler.status.lastkey = lastkey;
      this.currentHandler.status.depthCounter = depthCounter;
    }
  }

  // --- OPEN OBJECT -----------------------------------------------------------
  onopenobject(node) {
    if (this.streamingEngine) {
      this.streamingEngine.onopenobject(node);
      return;
    }
    this.currentHandler.openObject(node);
    this.shiftParser();
    this.updateLegacySkipDecode();
  }

  // ------ OPEN ARRAY -----------------------------------------------------------
  onopenarray() {
    if (this.streamingEngine) {
      this.streamingEngine.onopenarray();
      return;
    }
    this.currentHandler.openArray();
    this.shiftParser();
    this.updateLegacySkipDecode();
  }

  // --- CLOSE OBJECT  -------------------------------------------------------
  oncloseobject() {
    if (this.streamingEngine) {
      this.streamingEngine.oncloseobject();
      return;
    }
    this.currentHandler.closeObject();
    this.updateLegacySkipDecode();
    this.checkStreams();
  }

  // --- CLOSE ARRAY  -------------------------------------------------------
  onclosearray() {
    if (this.streamingEngine) {
      this.streamingEngine.onclosearray();
      return;
    }
    this.currentHandler.closeArray();
    this.updateLegacySkipDecode();
    this.checkStreams();
  }

  // ------ KEY  --------------------------------------------------------
  onkey(node) {
    if (this.streamingEngine) {
      this.streamingEngine.onkey(node);
      return;
    }
    this.currentHandler.key(node);
    this.shiftParser();
    this.updateLegacySkipDecode();
    this.checkStreams();
  }
  // ------ END KEY  --------------------------------------------------------

  //--- VALUE -----------------------------------------------------------
  onvalue(node) {
    if (this.streamingEngine) {
      this.streamingEngine.onvalue(node);
      return;
    }
    this.currentHandler.value(node);
    this.updateLegacySkipDecode();
    this.checkStreams();
  }

  //---END VALUE -----------------------------------------------------------
  endOutput() {
    if (this.streamingEngine) {
      this.engineClosed = true;
      if (!this.useString) {
        this.flushEngineStreamBuffer();
        this.output.push("]");
        this.output.push(null);
      } else {
        if (this.engineStringBuffer.length > 0) {
          this.engineOutputChunks.push(this.engineStringBuffer.join(""));
          this.engineStringBuffer = [];
          this.engineStringBufferLen = 0;
        }
        this.engineOutputChunks.push("]");
        this.callback(this.engineOutputChunks.join(""), this.error);
      }
      return;
    }
    this.currentHandler.status.close = true;
    if (!this.useString) {
      this.currentHandler.flushStreamBuffer();
      this.output.push("]");
      this.output.push(null);
    } else {
      this.currentHandler.flushStringBuffer();
      this.currentHandler.outputChunks.push("]");
      this.callback(this.currentHandler.outputChunks.join(""), this.error);
    }
  }

  onend() {
    if (this.streamingEngine) {
      if (!this.engineClosed) {
        this.endOutput();
      }
      return;
    }
    if (!this.currentHandler.status.close) {
      this.endOutput();
    }
  }

  onclose() {
    if (this.streamingEngine) {
      if (!this.engineClosed) {
        this.endOutput();
      }
      return;
    }
    if (!this.currentHandler.status.close) {
      this.endOutput();
    }
  }

  onerror(er) {
    this.error = new PifferoError(er);
    if (!this.useString) {
      if (this.streamingEngine) {
        this.engineClosed = true;
      } else {
        this.currentHandler.status.close = true;
      }
      this.output.destroy(this.error);
    }
  }
}

function jsonStringMatches(expectedQuoted: string, rawNode: any): boolean {
  if (expectedQuoted === rawNode) {
    return true;
  }
  if (typeof rawNode === "string" && rawNode.indexOf("\\") !== -1) {
    try {
      return JSON.stringify(JSON.parse(rawNode)) === expectedQuoted;
    } catch {
      return false;
    }
  }
  return false;
}

function extractFromParsed(obj: any, path: ParsedPath): any[] {
  if (!path) {
    return [obj];
  }
  const key =
    path.value.indexOf("\\") === -1
      ? path.value.slice(1, -1)
      : JSON.parse(path.value);
  if (obj === null || obj === undefined || typeof obj !== "object" || !(key in obj)) {
    return [];
  }
  const val = obj[key];
  if (Array.isArray(val) && (path.isbulk || path.range || (path.indexes && path.indexes.size > 0))) {
    const matched: any[] = [];
    for (let i = 0; i < val.length; i++) {
      let ok = false;
      if (path.indexes && path.indexes.size > 0) {
        ok = path.indexes.has(i);
      } else if (path.range) {
        const start =
          path.range.start !== undefined && path.range.start >= 0
            ? path.range.start
            : 0;
        const step = path.range.step !== undefined ? path.range.step : 1;
        ok =
          step > 0 &&
          i >= start &&
          (path.range.end === undefined || i < path.range.end) &&
          (i - start) % step === 0;
      }
      if (ok) {
        if (path.next) {
          matched.push(...extractFromParsed(val[i], path.next));
        } else {
          matched.push(val[i]);
        }
      }
    }
    return matched;
  }
  if (path.next) {
    return extractFromParsed(val, path.next);
  }
  return [val];
}

class SingleStepHandler {
  status: PifferoStatus;
  isLast = false;
  _output: Readable;
  _inputStream: Readable;
  useString = false;
  outputChunks: string[] = ["["];
  private stringBuffer: string[] = [];
  private stringBufferLen = 0;
  private streamBuffer: string[] = [];
  private streamBufferLen = 0;
  private postConditionPath: ParsedPath = null;
  private candidateChunks: string[] = [];
  private hasEmittedPostCondition = false;
  push: (value: string) => void;
  private emitOutput: (value: string) => void;

  constructor(
    path: ParsedPath,
    output: Readable,
    inputStream: Readable,
    useString: boolean,
    isBulk: boolean = false
  ) {
    this.useString = useString;
    this.status = new PifferoStatus(path, isBulk);
    this._output = output;
    this._inputStream = inputStream;
    this.isLast =
      path.next == undefined || path.next == null || path.hascondtion;
    if (path.hascondtion && path.next) {
      this.postConditionPath = path.next;
    }
    if (this.isLast) {
      if (this.useString) {
        this.emitOutput = (value: string) => {
          this.stringBuffer.push(value);
          this.stringBufferLen += value.length;
          if (this.stringBufferLen >= STRING_CHUNK_THRESHOLD) {
            this.flushStringBuffer();
          }
        };
      } else {
        this.emitOutput = (value: string) => {
          this.streamBuffer.push(value);
          this.streamBufferLen += value.length;
          if (this.streamBufferLen >= STREAM_CHUNK_THRESHOLD) {
            this.flushStreamBuffer();
          }
        };
      }
      if (this.postConditionPath) {
        this.push = (value: string) => this.candidateChunks.push(value);
      } else {
        this.push = this.emitOutput;
      }
    }
  }

  flushStringBuffer() {
    if (this.stringBuffer.length > 0) {
      this.outputChunks.push(this.stringBuffer.join(""));
      this.stringBuffer = [];
      this.stringBufferLen = 0;
    }
  }

  flushStreamBuffer() {
    if (this.streamBuffer.length > 0) {
      const chunk = this.streamBuffer.join("");
      this.streamBuffer = [];
      this.streamBufferLen = 0;
      if (!this._output.push(chunk) && this._inputStream && !this._inputStream.isPaused()) {
        this._inputStream.pause();
      }
    }
  }

  flushCandidateObject() {
    if (!this.postConditionPath || this.candidateChunks.length === 0) {
      return;
    }
    const raw = this.candidateChunks.join("");
    this.candidateChunks = [];
    const obj = JSON.parse(raw);
    const extracted = extractFromParsed(obj, this.postConditionPath);
    for (const item of extracted) {
      const serialized = JSON.stringify(item);
      if (this.hasEmittedPostCondition) {
        this.emitOutput(`,${serialized}`);
      } else {
        this.emitOutput(serialized);
        this.hasEmittedPostCondition = true;
      }
    }
    this.status.recording = false;
    this.status.verified = false;
    this.status.waitingForArrayClosing = true;
    this.status.depthCounter++;
  }

  stopHandler(force = false) {
    const status = this.status;
    status.verified = false;
    if (!status.isBulkResponse || force) {
      status.recording = false;
      status.end = true; // temporaneo
    } else {
      status.waitingForArrayClosing = true;
    }
  }

  openObject(node: any) {
    const status = this.status;
    if (status.end) {
      return;
    }
    if (status.recording && status.verified && this.isLast) {
      const string = node === undefined ? "{" : `{${node}:`;
      if (
        status.depthCounter === 0 ||
        (status.isMatching && status.depthCounter === 1)
      ) {
        this.stopHandler();
        status.resetTemp(`,${string}`);
        status.depthCounter++;
      } else {
        if (status.needComma) {
          this.push(`,${string}`);
        } else {
          this.push(`${string}`);
        }
      }
    } else if (jsonStringMatches(status.path.value, node) && status.depthCounter === 0) {
      if (!status.isInArray) {
        status.recording = true;
        status.verified = true;
      } else {
        status.isMatching = true;
      }
    } else if (status.isMatching && status.depthCounter === 2) {
      status.currentIndex++;
      // se lavoriamo con un indice
      if (status.path.isbulk && status.checkIndex()) {
        if (this.isLast) {
          this.push(`{${node}:`);
        }
        status.recording = true;
        status.verified = true;
        status.depthCounter--;
        // --------------- condition per json path query -------
      }
      if (status.path.condition) {
        status.resetTemp(`{${node}:`);
      }
    } else if (status.isMatching && status.depthCounter > 2) {
      if (status.hasTemp()) {
        if (status.needComma) {
          status.appendTemp(`,{${node}:`);
        } else {
          status.appendTemp(`{${node}:`);
        }
      }
    }
    // ----------

    if (status.last !== FIRST) {
      status.depthCounter++;
    }

    status.lastkey = node;
    status.last = OPEN_OBJECT;
  }

  closeObject() {
    const status = this.status;
    if (status.end) {
      return;
    }
    if (status.recording && status.verified && this.isLast) {
      if (status.depthCounter === 1) {
        this.stopHandler();
      } else {
        this.push(`}`);
        if (this.postConditionPath && status.depthCounter === 2) {
          this.flushCandidateObject();
        }
      }
    }
    //------ condition case ----------
    else if (status.isMatching && status.depthCounter > 2) {
      if (status.hasTemp()) {
        if (status.needComma) {
          status.appendTemp(",");
        }
        status.appendTemp("}");
      }
    }
    // -------------
    status.depthCounter--;
    status.last = CLOSE_OBJECT;
  }

  openArray() {
    const status = this.status;
    if (status.end) {
      return;
    }
    if (status.recording && status.verified && this.isLast) {
      if (
        (status.depthCounter === 0 ||
          (status.isMatching && status.depthCounter === 1)) &&
        status.path.value !== '"$"' // accrocco;
      ) {
        this.stopHandler();
      } else {
        if (status.needComma) {
          this.push(",[");
        } else {
          this.push("[");
        }
      }
    }
    // ------ condition case -------
    else if (status.isMatching && status.depthCounter > 2) {
      if (status.hasTemp()) {
        if (status.needComma) {
          status.appendTemp(",");
        }
        status.appendTemp("[");
      }
    } else if (status.depthCounter === 3) {
      status.resetTemp();
    } else if (status.isMatching && status.depthCounter === 2) {
      status.currentIndex++;
      if (status.path.isbulk && status.checkIndex()) {
        if (this.isLast) {
          this.push(`[`);
        }
        status.recording = true;
        status.verified = true;
        status.depthCounter--; // da verificare
        // --------------- condition per json path query -------
      } else if (status.path.condition) {
        status.resetTemp(`[`);
      }
    }
    // ---------------
    status.depthCounter++;
    status.last = OPEN_ARRAY;
  }

  closeArray() {
    const status = this.status;
    if (status.end) {
      return;
    }
    if (status.recording && status.verified && this.isLast) {
      if (status.depthCounter === 1) {
        this.stopHandler();
        status._needComma = true;
        if (!status.path.isbulk && !status.path.hascondtion) {
          this.push(`]`);
        }
      } else {
        this.push(`]`);
      }
    } else if (status.waitingForArrayClosing && status.depthCounter === 2) {
      this.stopHandler(true);
    }
    //------ condition case close array----------
    else if (status.isMatching && status.depthCounter > 3) {
      if (status.hasTemp()) {
        if (status.needComma) {
          status.appendTemp(",");
        }
        status.appendTemp("]");
      }
    }
    status.depthCounter--;
    status.last = CLOSE_ARRAY;
  }

  key(node: any) {
    const status = this.status;
    if (status.end) {
      return;
    }
    if (status.depthCounter === 1 && status.recording && this.isLast) {
      this.stopHandler();
    }
    if (status.recording && status.verified && this.isLast) {
      if (status.needComma) {
        this.push(`,${node}:`);
      } else {
        this.push(`${node}:`);
      }
    } else if (status.depthCounter === 1 && jsonStringMatches(status.path.value, node)) {
      if (!status.isInArray) {
        status.recording = true;
        status.verified = true;
      } else {
        status.isMatching = true;
      }
    } //------ condition case key----------
    else if (status.isMatching && status.depthCounter > 2) {
      if (status.hasTemp()) {
        if (status.needComma) {
          status.appendTemp(",");
        }
        status.appendTemp(`${node}:`);
      }
    }
    status.lastkey = node;
    status.last = KEY;
  }

  value(node: any) {
    const status = this.status;
    if (status.last === OPEN_ARRAY && status.depthCounter === 2) {
      status.isPrimitiveTypeArray = true;
    }
    if (
      status.isInArray &&
      status.isMatching &&
      status.isPrimitiveTypeArray &&
      status.depthCounter === 2
    ) {
      status.currentIndex++;
      if (status.checkIndex() && !status.close) {
        if (status.currentIndex > status.path.range.start) {
          this.push(`,${node}`);
        } else {
          this.push(`${node}`);
        }
        this.stopHandler();
        status._needComma = true;
      }
    }
    if (status.recording && status.verified && this.isLast) {
      if (status.needComma) {
        this.push(`,${node}`);
      } else {
        this.push(`${node}`);
      }
      if (status.depthCounter === 1) {
        this.stopHandler();
        status._needComma = true;
      }
      ///-----condition value -----
    } else if (status.path.hascondtion && this.verifyCondition(node)) {
      status.recording = true;
      status.verified = true;
      status.depthCounter--;
      this.push(status.flushTemp());
      if (status.needComma && !this.postConditionPath) {
        this.push(`,${node}`);
      } else {
        this.push(node);
      }
    } else if (status.isMatching && status.depthCounter > 2) {
      if (status.hasTemp()) {
        if (status.needComma) {
          status.appendTemp(",");
        }
        status.appendTemp(node);
      }
    }
    status.last = VALUE;
  }

  verifyCondition(value): boolean {
    const status = this.status;
    const condition = status.path.condition;
    return (
      status.isMatching &&
      status.depthCounter === 3 &&
      jsonStringMatches(condition.key, status.lastkey) &&
      (status.last === KEY || status.last === OPEN_OBJECT) &&
      (condition.value === value ||
        (condition.value.startsWith('"') && jsonStringMatches(condition.value, value)))
    );
  }
}

export type ParsedPath = LegacyParsedPath;

export function parse(jsonPath: string): ParsedPath {
  const steps = tokenizeJsonPath(jsonPath);
  return buildLegacyAndDetermineEngine(jsonPath, steps);
}
