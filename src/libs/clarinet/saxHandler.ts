export interface SaxHandler {
  skipDecode?: boolean;
  onopenobject(node: any): void;
  oncloseobject(): void;
  onopenarray(): void;
  onclosearray(): void;
  onkey(node: any): void;
  onvalue(node: any): void;
  onend(): void;
  onclose(): void;
  onerror(er: any): void;
}
