import { StringDecoder } from "string_decoder";

/**
 * Streaming top-level JSON array splitter for `[item1,item2,...]` byte/string chunks.
 * Emits each complete JSON-encoded element as soon as its delimiter (`,` or `]`) is reached,
 * handling arbitrary chunk boundaries, escaped strings, nested structures, and multi-byte UTF-8.
 */
export class JsonArrayItemSplitter {
  private decoder = new StringDecoder("utf8");
  private started = false;
  private finished = false;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private hasContent = false;
  private parts: string[] = [];

  push(chunk: Buffer | string): string[] {
    const str = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    return this.processString(str);
  }

  end(): string[] {
    const tail = this.decoder.end();
    if (tail.length > 0) {
      return this.processString(tail);
    }
    return [];
  }

  private processString(str: string): string[] {
    const items: string[] = [];
    if (this.finished || str.length === 0) {
      return items;
    }

    let i = 0;
    const len = str.length;

    if (!this.started) {
      while (i < len) {
        if (str.charCodeAt(i) === 0x5b) {
          // '['
          this.started = true;
          i++;
          break;
        }
        i++;
      }
      if (!this.started) {
        return items;
      }
    }

    let sliceStart = i;

    for (; i < len; i++) {
      const code = str.charCodeAt(i);

      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (code === 0x5c) {
          // '\'
          this.escaped = true;
        } else if (code === 0x22) {
          // '"'
          this.inString = false;
        }
        continue;
      }

      if (code === 0x22) {
        // '"'
        this.inString = true;
        this.hasContent = true;
        continue;
      }

      if (code === 0x7b || code === 0x5b) {
        // '{' or '['
        this.depth++;
        this.hasContent = true;
        continue;
      }

      if (code === 0x7d) {
        // '}'
        if (this.depth > 0) {
          this.depth--;
        }
        continue;
      }

      if (code === 0x5d) {
        // ']'
        if (this.depth > 0) {
          this.depth--;
          continue;
        }
        if (this.hasContent) {
          if (i > sliceStart) {
            this.parts.push(str.slice(sliceStart, i));
          }
          items.push(
            this.parts.length === 1 ? this.parts[0] : this.parts.join("")
          );
          this.parts = [];
          this.hasContent = false;
        }
        this.finished = true;
        return items;
      }

      if (code === 0x2c && this.depth === 0) {
        // ','
        if (this.hasContent) {
          if (i > sliceStart) {
            this.parts.push(str.slice(sliceStart, i));
          }
          items.push(
            this.parts.length === 1 ? this.parts[0] : this.parts.join("")
          );
          this.parts = [];
          this.hasContent = false;
        }
        sliceStart = i + 1;
        continue;
      }

      if (!this.hasContent) {
        if (code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09) {
          sliceStart = i + 1;
        } else {
          this.hasContent = true;
        }
      }
    }

    if (this.hasContent && len > sliceStart) {
      this.parts.push(str.slice(sliceStart, len));
    }

    return items;
  }
}
