import { Writable } from "stream";
import { StringDecoder } from "string_decoder";

import { SaxHandler } from "./saxHandler";
export { SaxHandler };

const Char = {
  tab: 0x09, // \t
  lineFeed: 0x0a, // \n
  carriageReturn: 0x0d, // \r
  space: 0x20, // " "

  doubleQuote: 0x22, // "
  plus: 0x2b, // +
  comma: 0x2c, // ,
  minus: 0x2d, // -
  period: 0x2e, // .

  _0: 0x30, // 0
  _9: 0x39, // 9

  colon: 0x3a, // :

  E: 0x45, // E

  openBracket: 0x5b, // [
  backslash: 0x5c, // \
  closeBracket: 0x5d, // ]

  a: 0x61, // a
  b: 0x62, // b
  e: 0x65, // e
  f: 0x66, // f
  l: 0x6c, // l
  n: 0x6e, // n
  r: 0x72, // r
  s: 0x73, // s
  t: 0x74, // t
  u: 0x75, // u

  openBrace: 0x7b, // {
  closeBrace: 0x7d, // }
};

let _S: any = 0;

const STATE = {
  BEGIN: _S++,
  VALUE: _S++, // general stuff
  OPEN_OBJECT: _S++, // {
  CLOSE_OBJECT: _S++, // }
  OPEN_ARRAY: _S++, // [
  CLOSE_ARRAY: _S++, // ]
  TEXT_ESCAPE: _S++, // \ stuff
  STRING: _S++, // ""
  BACKSLASH: _S++,
  END: _S++, // No more stack
  OPEN_KEY: _S++, // , "a"
  CLOSE_KEY: _S++, // :
  TRUE: _S++, // r
  TRUE2: _S++, // u
  TRUE3: _S++, // e
  FALSE: _S++, // a
  FALSE2: _S++, // l
  FALSE3: _S++, // s
  FALSE4: _S++, // e
  NULL: _S++, // u
  NULL2: _S++, // l
  NULL3: _S++, // l
  NUMBER_DECIMAL_POINT: _S++, // .
  NUMBER_DIGIT: _S++, // [0-9]
};

for (const s_ in STATE) STATE[STATE[s_]] = s_;

const S = STATE;

class CParser {
  opt: any;
  handler: SaxHandler;
  c: any = "";
  p: any = "";
  closed = false;
  closedRoot = false;
  sawRoot = false;
  tag = null;
  errorString: any = null;
  state = S.BEGIN;
  stack: number[] = [];
  column = 0;
  line = 1;
  slashed = false;
  depth = 0;
  onerror: any;
  numberNode = "";
  textNode: string | undefined = undefined;
  private hasPendingText = false;
  private pendingBuf: Buffer | null = null;
  private pendingStart = 0;
  private pendingEnd = 0;
  private strDecoder: StringDecoder | null = null;

  constructor(handler: SaxHandler, opt?: any) {
    this.handler = handler;
    this.opt = opt ? opt : {};
    this.clearBuffers();
  }

  clearBuffers() {
    this.textNode = undefined;
    this.numberNode = "";
    this.hasPendingText = false;
    this.pendingBuf = null;
    this.strDecoder = null;
  }

  isWhitespace(c: number): boolean {
    return (
      c === Char.space ||
      c === Char.carriageReturn ||
      c === Char.lineFeed ||
      c === Char.tab
    );
  }

  writeBuffer(buf: Buffer) {
    if (this.errorString) throw this.errorString;
    if (this.closed) {
      return this.error("Cannot write after close. Assign an onready handler.");
    }
    const len = buf.length;
    if (len === 0) return this;

    let i = 0;
    let p: any = this.p;
    let c: any = buf[0];
    let line = this.line;
    let col = this.column;
    let nextSlash = -2;
    const handler = this.handler;
    const stack = this.stack;

    while (i < len) {
      p = c;
      c = buf[i++];

      if (c <= Char.space) {
        if (c === Char.lineFeed) {
          line++;
          col = 0;
        } else {
          col++;
        }
      } else {
        col++;
      }

      switch (this.state) {
        case S.BEGIN:
          if (c === Char.openBrace) this.state = S.OPEN_OBJECT;
          else if (c === Char.openBracket) this.state = S.OPEN_ARRAY;
          else if (
            c !== Char.space &&
            c !== Char.carriageReturn &&
            c !== Char.lineFeed &&
            c !== Char.tab
          ) {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Non-whitespace before {[.");
          }
          continue;

        case S.OPEN_KEY:
        case S.OPEN_OBJECT:
          if (
            c === Char.space ||
            c === Char.carriageReturn ||
            c === Char.lineFeed ||
            c === Char.tab
          ) {
            continue;
          }
          if (this.state === S.OPEN_KEY) {
            stack.push(S.CLOSE_KEY);
          } else {
            if (c === Char.closeBrace) {
              handler.onopenobject(undefined);
              this.depth++;
              handler.oncloseobject();
              this.depth--;
              this.state = stack.pop() || S.VALUE;
              if (this.closed) return this;
              continue;
            } else {
              stack.push(S.CLOSE_OBJECT);
            }
          }
          if (c === Char.doubleQuote) {
            this.state = S.STRING;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error('Malformed object key should start with "');
          }
          continue;

        case S.CLOSE_KEY:
        case S.CLOSE_OBJECT:
          if (
            c === Char.space ||
            c === Char.carriageReturn ||
            c === Char.lineFeed ||
            c === Char.tab
          ) {
            continue;
          }
          if (c === Char.colon) {
            if (this.state === S.CLOSE_OBJECT) {
              stack.push(S.CLOSE_OBJECT);
              this.closeValue("onopenobject");
              this.depth++;
            } else {
              this.closeValue("onkey");
            }
            this.state = S.VALUE;
            if (this.closed) return this;
          } else if (c === Char.closeBrace) {
            this.closeValue("onvalue");
            handler.oncloseobject();
            this.depth--;
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          } else if (c === Char.comma) {
            if (this.state === S.CLOSE_OBJECT) {
              stack.push(S.CLOSE_OBJECT);
            }
            this.closeValue("onvalue");
            this.state = S.OPEN_KEY;
            if (this.closed) return this;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Bad object");
          }
          continue;

        case S.OPEN_ARRAY:
        case S.VALUE:
          if (
            c === Char.space ||
            c === Char.carriageReturn ||
            c === Char.lineFeed ||
            c === Char.tab
          ) {
            continue;
          }
          if (this.state === S.OPEN_ARRAY) {
            handler.onopenarray();
            this.depth++;
            this.state = S.VALUE;
            if (c === Char.closeBracket) {
              handler.onclosearray();
              this.depth--;
              this.state = stack.pop() || S.VALUE;
              if (this.closed) return this;
              continue;
            } else {
              stack.push(S.CLOSE_ARRAY);
            }
          }
          if (c === Char.doubleQuote) {
            this.state = S.STRING;
          } else if (c === Char.openBrace) {
            this.state = S.OPEN_OBJECT;
          } else if (c === Char.openBracket) {
            this.state = S.OPEN_ARRAY;
          } else if (c === Char.t) {
            if (
              i + 2 < len &&
              buf[i] === Char.r &&
              buf[i + 1] === Char.u &&
              buf[i + 2] === Char.e
            ) {
              i += 3;
              col += 3;
              c = Char.e;
              handler.onvalue(handler.skipDecode ? "" : "true");
              this.state = stack.pop() || S.VALUE;
              if (this.closed) return this;
            } else {
              this.state = S.TRUE;
            }
          } else if (c === Char.f) {
            if (
              i + 3 < len &&
              buf[i] === Char.a &&
              buf[i + 1] === Char.l &&
              buf[i + 2] === Char.s &&
              buf[i + 3] === Char.e
            ) {
              i += 4;
              col += 4;
              c = Char.e;
              handler.onvalue(handler.skipDecode ? "" : "false");
              this.state = stack.pop() || S.VALUE;
              if (this.closed) return this;
            } else {
              this.state = S.FALSE;
            }
          } else if (c === Char.n) {
            if (
              i + 2 < len &&
              buf[i] === Char.u &&
              buf[i + 1] === Char.l &&
              buf[i + 2] === Char.l
            ) {
              i += 3;
              col += 3;
              c = Char.l;
              handler.onvalue(handler.skipDecode ? "" : "null");
              this.state = stack.pop() || S.VALUE;
              if (this.closed) return this;
            } else {
              this.state = S.NULL;
            }
          } else if (c === Char.minus) {
            if (!handler.skipDecode) {
              this.numberNode += "-";
            }
          } else if (Char._0 <= c && c <= Char._9) {
            let j = i;
            while (j < len) {
              const d = buf[j];
              if (d >= Char._0 && d <= Char._9) {
                j++;
              } else {
                break;
              }
            }
            if (
              j < len &&
              buf[j] !== Char.period &&
              buf[j] !== Char.e &&
              buf[j] !== Char.E &&
              buf[j] !== Char.plus &&
              buf[j] !== Char.minus
            ) {
              col += j - i;
              if (handler.skipDecode) {
                this.numberNode = "";
                handler.onvalue("");
              } else {
                const num =
                  this.numberNode.length > 0
                    ? this.numberNode + buf.toString("ascii", i - 1, j)
                    : buf.toString("ascii", i - 1, j);
                this.numberNode = "";
                handler.onvalue(num);
              }
              c = buf[j - 1];
              i = j;
              this.state = stack.pop() || S.VALUE;
              if (this.closed) return this;
            } else {
              col += j - i;
              if (!handler.skipDecode) {
                this.numberNode += buf.toString("ascii", i - 1, j);
              } else {
                this.numberNode = "0";
              }
              c = buf[j - 1];
              i = j;
              this.state = S.NUMBER_DIGIT;
            }
          }
          continue;

        case S.CLOSE_ARRAY:
          if (c === Char.comma) {
            this.closeValue("onvalue");
            stack.push(S.CLOSE_ARRAY);
            this.state = S.VALUE;
            if (this.closed) return this;
          } else if (c === Char.closeBracket) {
            this.closeValue("onvalue");
            handler.onclosearray();
            this.depth--;
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          } else if (
            c === Char.space ||
            c === Char.carriageReturn ||
            c === Char.lineFeed ||
            c === Char.tab
          ) {
            continue;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Bad array");
          }
          continue;

        case S.STRING: {
          let starti = i - 1;
          const skipDecode = Boolean(handler.skipDecode);

          if (this.slashed) {
            this.slashed = false;
            const esc = buf[starti];
            if (!skipDecode) {
              if (esc < 0x80) {
                if (this.strDecoder) {
                  this.textNode =
                    (this.textNode || "") +
                    this.strDecoder.end() +
                    "\\" +
                    String.fromCharCode(esc);
                  this.strDecoder = null;
                } else {
                  this.textNode =
                    (this.textNode || "") + "\\" + String.fromCharCode(esc);
                }
              } else {
                if (!this.strDecoder) {
                  this.strDecoder = new StringDecoder("utf8");
                }
                this.textNode =
                  (this.textNode || "") +
                  "\\" +
                  this.strDecoder.write(buf.subarray(starti, starti + 1));
              }
            }
            starti++;
            if (starti >= len) {
              i = len;
              c = buf[len - 1];
              continue;
            }
          }

          if (nextSlash === -2 || (nextSlash !== -1 && nextSlash < starti)) {
            nextSlash = buf.indexOf(Char.backslash, starti);
          }
          const quoteIdx = buf.indexOf(Char.doubleQuote, starti);

          if (quoteIdx !== -1 && (nextSlash === -1 || nextSlash > quoteIdx)) {
            if (!skipDecode) {
              if (this.strDecoder) {
                this.textNode =
                  (this.textNode || "") +
                  this.strDecoder.write(buf.subarray(starti, quoteIdx)) +
                  this.strDecoder.end();
                this.strDecoder = null;
                this.pendingBuf = null;
              } else if (this.textNode !== undefined) {
                this.textNode += buf.toString("utf8", starti, quoteIdx);
                this.pendingBuf = null;
              } else {
                this.pendingBuf = buf;
                this.pendingStart = starti;
                this.pendingEnd = quoteIdx;
              }
            }
            this.hasPendingText = true;
            c = Char.doubleQuote;
            i = quoteIdx + 1;
            this.state = stack.pop() || S.VALUE;
            continue;
          }

          // Slow path: escapes or chunk-spanning string
          while (starti < len) {
            const q = buf.indexOf(Char.doubleQuote, starti);
            if (nextSlash !== -1 && nextSlash < starti) {
              nextSlash = buf.indexOf(Char.backslash, starti);
            }
            if (nextSlash !== -1 && (q === -1 || nextSlash < q)) {
              if (!skipDecode) {
                if (this.strDecoder) {
                  this.textNode =
                    (this.textNode || "") +
                    this.strDecoder.write(buf.subarray(starti, nextSlash)) +
                    this.strDecoder.end();
                  this.strDecoder = null;
                } else {
                  this.textNode =
                    (this.textNode || "") +
                    buf.toString("utf8", starti, nextSlash);
                }
              }
              if (nextSlash + 1 < len) {
                const esc = buf[nextSlash + 1];
                if (!skipDecode) {
                  if (esc < 0x80) {
                    this.textNode =
                      (this.textNode || "") + "\\" + String.fromCharCode(esc);
                  } else {
                    if (!this.strDecoder) {
                      this.strDecoder = new StringDecoder("utf8");
                    }
                    this.textNode =
                      (this.textNode || "") +
                      "\\" +
                      this.strDecoder.write(
                        buf.subarray(nextSlash + 1, nextSlash + 2)
                      );
                  }
                }
                starti = nextSlash + 2;
                nextSlash = buf.indexOf(Char.backslash, starti);
                continue;
              } else {
                this.slashed = true;
                starti = len;
                break;
              }
            } else if (q !== -1) {
              if (!skipDecode) {
                if (this.strDecoder) {
                  this.textNode =
                    (this.textNode || "") +
                    this.strDecoder.write(buf.subarray(starti, q)) +
                    this.strDecoder.end();
                  this.strDecoder = null;
                } else {
                  this.textNode =
                    (this.textNode || "") + buf.toString("utf8", starti, q);
                }
                this.pendingBuf = null;
              }
              this.hasPendingText = true;
              c = Char.doubleQuote;
              i = q + 1;
              this.state = stack.pop() || S.VALUE;
              break;
            } else {
              if (!skipDecode) {
                if (!this.strDecoder) {
                  this.strDecoder = new StringDecoder("utf8");
                }
                this.textNode =
                  (this.textNode || "") +
                  this.strDecoder.write(buf.subarray(starti));
              }
              starti = len;
              i = len;
              c = buf[len - 1];
              break;
            }
          }
          if (starti >= len) {
            i = len;
            c = buf[len - 1];
          }
          continue;
        }

        case S.TRUE:
          if (c === Char.r) this.state = S.TRUE2;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid true started with t" + c);
          }
          continue;

        case S.TRUE2:
          if (c === Char.u) this.state = S.TRUE3;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid true started with tr" + c);
          }
          continue;

        case S.TRUE3:
          if (c === Char.e) {
            handler.onvalue(handler.skipDecode ? "" : "true");
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid true started with tru" + c);
          }
          continue;

        case S.FALSE:
          if (c === Char.a) this.state = S.FALSE2;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid false started with f" + c);
          }
          continue;

        case S.FALSE2:
          if (c === Char.l) this.state = S.FALSE3;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid false started with fa" + c);
          }
          continue;

        case S.FALSE3:
          if (c === Char.s) this.state = S.FALSE4;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid false started with fal" + c);
          }
          continue;

        case S.FALSE4:
          if (c === Char.e) {
            handler.onvalue(handler.skipDecode ? "" : "false");
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid false started with fals" + c);
          }
          continue;

        case S.NULL:
          if (c === Char.u) this.state = S.NULL2;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid null started with n" + c);
          }
          continue;

        case S.NULL2:
          if (c === Char.l) this.state = S.NULL3;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid null started with nu" + c);
          }
          continue;

        case S.NULL3:
          if (c === Char.l) {
            handler.onvalue(handler.skipDecode ? "" : "null");
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid null started with nul" + c);
          }
          continue;

        case S.NUMBER_DECIMAL_POINT:
          if (c === Char.period) {
            if (!handler.skipDecode) this.numberNode += ".";
            this.state = S.NUMBER_DIGIT;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Leading zero not followed by .");
          }
          continue;

        case S.NUMBER_DIGIT:
          if (Char._0 <= c && c <= Char._9) {
            let j = i;
            while (j < len) {
              const d = buf[j];
              if (d >= Char._0 && d <= Char._9) j++;
              else break;
            }
            col += j - i;
            if (!handler.skipDecode) {
              this.numberNode += buf.toString("ascii", i - 1, j);
            }
            c = buf[j - 1];
            i = j;
          } else if (c === Char.period) {
            if (this.numberNode.indexOf(".") !== -1) {
              this.line = line;
              this.column = col;
              this.c = c;
              this.error("Invalid number has two dots");
            }
            this.numberNode += ".";
          } else if (c === Char.e || c === Char.E) {
            if (
              this.numberNode.indexOf("e") !== -1 ||
              this.numberNode.indexOf("E") !== -1
            ) {
              this.line = line;
              this.column = col;
              this.c = c;
              this.error("Invalid number has two exponential");
            }
            this.numberNode += "e";
          } else if (c === Char.plus || c === Char.minus) {
            if (!(p === Char.e || p === Char.E)) {
              this.line = line;
              this.column = col;
              this.c = c;
              this.error("Invalid symbol in number");
            }
            if (!handler.skipDecode) {
              this.numberNode += String.fromCharCode(c);
            }
          } else {
            this.closeNumber();
            i--; // go back one
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          }
          continue;

        default:
          this.line = line;
          this.column = col;
          this.c = c;
          this.error("Unknown state: " + this.state);
      }
    }

    if (this.hasPendingText && this.pendingBuf !== null) {
      if (!handler.skipDecode) {
        this.textNode = this.pendingBuf.toString(
          "utf8",
          this.pendingStart,
          this.pendingEnd
        );
      }
      this.pendingBuf = null;
    }

    this.line = line;
    this.column = col;
    this.p = c;
    this.c = NaN;
    return this;
  }

  write(chunk: string) {
    if (this.errorString) throw this.errorString;
    if (this.closed) {
      return this.error("Cannot write after close. Assign an onready handler.");
    }
    if (chunk === null) {
      return this.end();
    }
    const len = chunk.length;
    if (len === 0) return this;

    let i = 0;
    let c: any = chunk.charCodeAt(0);
    let p: any = this.p;
    let line = this.line;
    let col = this.column;
    let nextSlash = -2;
    const handler = this.handler;
    const stack = this.stack;

    while (i < len) {
      p = c;
      c = chunk.charCodeAt(i++);

      if (c === Char.lineFeed) {
        line++;
        col = 0;
      } else {
        col++;
      }

      switch (this.state) {
        case S.BEGIN:
          if (c === Char.openBrace) this.state = S.OPEN_OBJECT;
          else if (c === Char.openBracket) this.state = S.OPEN_ARRAY;
          else if (!this.isWhitespace(c)) {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Non-whitespace before {[.");
          }
          continue;
        case S.OPEN_KEY:
        case S.OPEN_OBJECT:
          if (this.isWhitespace(c)) continue;
          if (this.state === S.OPEN_KEY) {
            stack.push(S.CLOSE_KEY);
          } else {
            if (c === Char.closeBrace) {
              handler.onopenobject(undefined);
              this.depth++;
              handler.oncloseobject();
              this.depth--;
              this.state = stack.pop() || S.VALUE;
              if (this.closed) return this;
              continue;
            } else stack.push(S.CLOSE_OBJECT);
          }
          if (c === Char.doubleQuote) this.state = S.STRING;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error('Malformed object key should start with "');
          }
          continue;

        case S.CLOSE_KEY:
        case S.CLOSE_OBJECT:
          if (this.isWhitespace(c)) continue;
          if (c === Char.colon) {
            if (this.state === S.CLOSE_OBJECT) {
              stack.push(S.CLOSE_OBJECT);
              this.closeValue("onopenobject");
              this.depth++;
            } else this.closeValue("onkey");
            this.state = S.VALUE;
            if (this.closed) return this;
          } else if (c === Char.closeBrace) {
            this.closeValue("onvalue");
            handler.oncloseobject();
            this.depth--;
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          } else if (c === Char.comma) {
            if (this.state === S.CLOSE_OBJECT) {
              stack.push(S.CLOSE_OBJECT);
            }
            this.closeValue("onvalue");
            this.state = S.OPEN_KEY;
            if (this.closed) return this;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Bad object");
          }
          continue;

        case S.OPEN_ARRAY:
        case S.VALUE:
          if (this.isWhitespace(c)) continue;
          if (this.state === S.OPEN_ARRAY) {
            handler.onopenarray();
            this.depth++;
            this.state = S.VALUE;
            if (c === Char.closeBracket) {
              handler.onclosearray();
              this.depth--;
              this.state = stack.pop() || S.VALUE;
              if (this.closed) return this;
              continue;
            } else {
              stack.push(S.CLOSE_ARRAY);
            }
          }
          if (c === Char.doubleQuote) this.state = S.STRING;
          else if (c === Char.openBrace) this.state = S.OPEN_OBJECT;
          else if (c === Char.openBracket) this.state = S.OPEN_ARRAY;
          else if (c === Char.t) this.state = S.TRUE;
          else if (c === Char.f) this.state = S.FALSE;
          else if (c === Char.n) this.state = S.NULL;
          else if (c === Char.minus) {
            this.numberNode += "-";
          } else if (Char._0 <= c && c <= Char._9) {
            let j = i;
            while (j < len) {
              const d = chunk.charCodeAt(j);
              if (d >= Char._0 && d <= Char._9) j++;
              else break;
            }
            col += j - i;
            this.numberNode += chunk.slice(i - 1, j);
            c = chunk.charCodeAt(j - 1);
            i = j;
            this.state = S.NUMBER_DIGIT;
          }
          continue;

        case S.CLOSE_ARRAY:
          if (c === Char.comma) {
            this.closeValue("onvalue");
            stack.push(S.CLOSE_ARRAY);
            this.state = S.VALUE;
            if (this.closed) return this;
          } else if (c === Char.closeBracket) {
            this.closeValue("onvalue");
            handler.onclosearray();
            this.depth--;
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          } else if (this.isWhitespace(c)) continue;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Bad array");
          }
          continue;

        case S.STRING: {
          let starti = i - 1;
          const skipDecode = Boolean(handler.skipDecode);

          if (this.slashed) {
            this.slashed = false;
            if (!skipDecode) {
              this.textNode = (this.textNode || "") + "\\" + chunk[starti];
            }
            starti++;
            if (starti >= len) {
              i = len;
              c = chunk.charCodeAt(len - 1);
              continue;
            }
          }

          if (nextSlash === -2 || (nextSlash !== -1 && nextSlash < starti)) {
            nextSlash = chunk.indexOf("\\", starti);
          }
          const quoteIdx = chunk.indexOf('"', starti);

          if (quoteIdx !== -1 && (nextSlash === -1 || nextSlash > quoteIdx)) {
            if (!skipDecode) {
              if (this.textNode !== undefined) {
                this.textNode += chunk.slice(starti, quoteIdx);
              } else {
                this.textNode = chunk.slice(starti, quoteIdx);
              }
            }
            this.hasPendingText = true;
            c = Char.doubleQuote;
            i = quoteIdx + 1;
            this.state = stack.pop() || S.VALUE;
            continue;
          }

          while (starti < len) {
            const q = chunk.indexOf('"', starti);
            if (nextSlash !== -1 && nextSlash < starti) {
              nextSlash = chunk.indexOf("\\", starti);
            }
            if (nextSlash !== -1 && (q === -1 || nextSlash < q)) {
              if (!skipDecode) {
                this.textNode =
                  (this.textNode || "") + chunk.slice(starti, nextSlash);
              }
              if (nextSlash + 1 < len) {
                if (!skipDecode) {
                  this.textNode =
                    (this.textNode || "") + "\\" + chunk[nextSlash + 1];
                }
                starti = nextSlash + 2;
                nextSlash = chunk.indexOf("\\", starti);
                continue;
              } else {
                this.slashed = true;
                starti = len;
                break;
              }
            } else if (q !== -1) {
              if (!skipDecode) {
                this.textNode = (this.textNode || "") + chunk.slice(starti, q);
              }
              this.hasPendingText = true;
              c = Char.doubleQuote;
              i = q + 1;
              this.state = stack.pop() || S.VALUE;
              break;
            } else {
              if (!skipDecode) {
                this.textNode = (this.textNode || "") + chunk.slice(starti);
              }
              starti = len;
              i = len;
              c = chunk.charCodeAt(len - 1);
              break;
            }
          }
          if (starti >= len) {
            i = len;
            c = chunk.charCodeAt(len - 1);
          }
          continue;
        }

        case S.TRUE:
          if (c === Char.r) this.state = S.TRUE2;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid true started with t" + c);
          }
          continue;

        case S.TRUE2:
          if (c === Char.u) this.state = S.TRUE3;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid true started with tr" + c);
          }
          continue;

        case S.TRUE3:
          if (c === Char.e) {
            handler.onvalue(handler.skipDecode ? "" : "true");
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid true started with tru" + c);
          }
          continue;

        case S.FALSE:
          if (c === Char.a) this.state = S.FALSE2;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid false started with f" + c);
          }
          continue;

        case S.FALSE2:
          if (c === Char.l) this.state = S.FALSE3;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid false started with fa" + c);
          }
          continue;

        case S.FALSE3:
          if (c === Char.s) this.state = S.FALSE4;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid false started with fal" + c);
          }
          continue;

        case S.FALSE4:
          if (c === Char.e) {
            handler.onvalue(handler.skipDecode ? "" : "false");
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid false started with fals" + c);
          }
          continue;

        case S.NULL:
          if (c === Char.u) this.state = S.NULL2;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid null started with n" + c);
          }
          continue;

        case S.NULL2:
          if (c === Char.l) this.state = S.NULL3;
          else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid null started with nu" + c);
          }
          continue;

        case S.NULL3:
          if (c === Char.l) {
            handler.onvalue(handler.skipDecode ? "" : "null");
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Invalid null started with nul" + c);
          }
          continue;

        case S.NUMBER_DECIMAL_POINT:
          if (c === Char.period) {
            this.numberNode += ".";
            this.state = S.NUMBER_DIGIT;
          } else {
            this.line = line;
            this.column = col;
            this.c = c;
            this.error("Leading zero not followed by .");
          }
          continue;

        case S.NUMBER_DIGIT:
          if (Char._0 <= c && c <= Char._9) {
            let j = i;
            while (j < len) {
              const d = chunk.charCodeAt(j);
              if (d >= Char._0 && d <= Char._9) j++;
              else break;
            }
            col += j - i;
            this.numberNode += chunk.slice(i - 1, j);
            c = chunk.charCodeAt(j - 1);
            i = j;
          } else if (c === Char.period) {
            if (this.numberNode.indexOf(".") !== -1) {
              this.line = line;
              this.column = col;
              this.c = c;
              this.error("Invalid number has two dots");
            }
            this.numberNode += ".";
          } else if (c === Char.e || c === Char.E) {
            if (
              this.numberNode.indexOf("e") !== -1 ||
              this.numberNode.indexOf("E") !== -1
            ) {
              this.line = line;
              this.column = col;
              this.c = c;
              this.error("Invalid number has two exponential");
            }
            this.numberNode += "e";
          } else if (c === Char.plus || c === Char.minus) {
            if (!(p === Char.e || p === Char.E)) {
              this.line = line;
              this.column = col;
              this.c = c;
              this.error("Invalid symbol in number");
            }
            this.numberNode += String.fromCharCode(c);
          } else {
            this.closeNumber();
            i--; // go back one
            this.state = stack.pop() || S.VALUE;
            if (this.closed) return this;
          }
          continue;

        default:
          this.line = line;
          this.column = col;
          this.c = c;
          this.error("Unknown state: " + this.state);
      }
    }
    this.line = line;
    this.column = col;
    this.p = c;
    this.c = NaN;
    return this;
  }

  end() {
    if (this.state !== S.VALUE || this.depth !== 0) {
      this.error("Unexpected end");
    }

    this.closeValue("onvalue");
    this.c = "";
    this.closed = true;
    this.handler.onend();
    return this;
  }

  closeValue(event: "onopenobject" | "onkey" | "onvalue") {
    if (this.hasPendingText) {
      let node: string;
      if (this.handler.skipDecode) {
        node = "";
        this.pendingBuf = null;
      } else if (this.pendingBuf !== null) {
        node = `"${this.pendingBuf.toString(
          "utf8",
          this.pendingStart,
          this.pendingEnd
        )}"`;
        this.pendingBuf = null;
      } else {
        node = `"${this.textNode || ""}"`;
      }
      this.textNode = undefined;
      this.hasPendingText = false;
      if (event === "onopenobject") {
        this.handler.onopenobject(node);
      } else if (event === "onkey") {
        this.handler.onkey(node);
      } else {
        this.handler.onvalue(node);
      }
    }
  }

  closeNumber() {
    if (this.numberNode) {
      this.handler.onvalue(this.handler.skipDecode ? "" : "" + this.numberNode);
      this.numberNode = "";
    }
  }

  error(er: any) {
    this.closeValue("onvalue");
    er +=
      "\nLine: " + this.line + "\nColumn: " + this.column + "\nChar: " + this.c;
    this.handler.onerror(er);
  }
}

const EVENTS = [
  "value",
  "string",
  "key",
  "openobject",
  "closeobject",
  "openarray",
  "closearray",
  "error",
  "end",
  "ready",
];

const streamWraps = EVENTS.filter(function (ev) {
  return ev !== "error" && ev !== "end";
});

export class CStream extends Writable {
  _parser: CParser;
  readable = true;
  handler: SaxHandler;

  constructor(handler: SaxHandler, opt?: any) {
    super(opt);
    this.handler = handler;
    this._parser = new CParser(handler, opt);

    this._parser.onerror = (er: any) => {
      this.handler.onerror(er);

      streamWraps.forEach(function (ev) {
        Object.defineProperty(this, "on" + ev, {
          get: function () {
            return this._parser["on" + ev];
          },
          set: function (h) {
            if (!h) {
              this.removeAllListeners(ev);
              this._parser["on" + ev] = h;
              return h;
            }
            this.on(ev, h);
          },
          enumerable: true,
          configurable: false,
        });
      });
    };
  }

  write(data: any): boolean {
    if (this._parser.closed) {
      return false;
    }
    if (Buffer.isBuffer(data)) {
      if (data.length > 0) {
        this._parser.writeBuffer(data);
      }
    } else if (typeof data === "string") {
      if (data.length > 0) {
        this._parser.write(data);
      }
    } else if (data != null) {
      const buf = Buffer.from(data);
      if (buf.length > 0) {
        this._parser.writeBuffer(buf);
      }
    }
    return true;
  }

  end(chunk?: any, _encoding?: any, cb?: () => void): this {
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = undefined;
    } else if (typeof _encoding === "function") {
      cb = _encoding;
    }
    if (this._parser.closed) {
      if (cb) cb();
      return this;
    }
    if (chunk) {
      this.write(chunk);
    }
    if (this._parser.closed) {
      if (cb) cb();
      return this;
    }
    this._parser.end();
    this.endParser();
    if (cb) cb();
    return this;
  }

  endParser() {
    if (this._parser.closed) {
      return;
    }
    if (this._parser.state !== S.VALUE || this._parser.depth !== 0) {
      this._parser.error("Unexpected end");
    }
    this._parser.closeValue("onvalue");
    this._parser.c = "";
    this._parser.closed = true;
    this.handler.onend();
  }

  destroy() {
    this._parser.closed = true;
    this._parser.clearBuffers();
    this.handler.onclose();
    return this;
  }
}
