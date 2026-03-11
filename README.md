# @isopodlabs/xml
[![npm version](https://img.shields.io/npm/v/@isopodlabs/xml.svg)](https://www.npmjs.com/package/@isopodlabs/xml)
[![GitHub stars](https://img.shields.io/github/stars/adrianstephens/xml.svg?style=social)](https://github.com/adrianstephens/xml)
[![License](https://img.shields.io/npm/l/@isopodlabs/xml.svg)](LICENSE.txt)


This package provides a complete solution for working with XML in TypeScript. It allows you to create, manipulate, and parse XML documents easily, and can parse html with appropriate options.

## ☕ Support My Work  
If you use this package, consider [buying me a cup of tea](https://coff.ee/adrianstephens) to support future updates!  

## Why

- Self Conatained
- Fast
- Simple


## Installation

To install the package, use npm:

```
npm install @isopodlabs/xml
```

## Importing the Package
```typescript
import * as xml from 'xml';
```

## Loading XML
```typescript
const xmlString = `<root><child>Text</child></root>`;
const rootElement = xml.parse(xmlString);
```

`parse` takes an optional `options` parameter:
```typescript
export interface InputOptions {
	entities?: Entities,
	allowUnclosed?: RegExp,
	allowAttributeWithoutValue?: boolean,
	allowNonQuotedAttribute?: boolean,
}
```
- `entities`: By default only `amp`, `gt`, `lt`, and `quot` entities are recognised. This option allows additional entities to be recognised.
- `allowUnclosed`: Allows tags that match this RegExp to omit their closing tag.
- `allowAttributeWithoutValue`: Allows attributes without the ="\<value\>" part.
- `allowNonQuotedAttribute`: Allows attributes to be unquoted.


## Writing XML
```typescript
const xmlString = rootElement.toString();
```

`toString` takes an optional `options` parameter:
```typescript
export interface OutputOptions {
	newline?: string,
	indent?: string,
	afteratt?: string,
	entities?: Entities,
}
```

- `newline`:  what to print after each element. Default is '\n'
- `indent`:   what to prepend to newline for each nested level of elements. Default is '  ' (two spaces)
- `afteratt`: what to print after the list of attributes. Default is '' (nothing)
- `entities`: additional entities to use when outputting text. Default uses only `amp`, `gt`, and `lt` (and `quot` inside attributes).

## Element
Represents an XML element.
```typescript
class Element {
//properties
    name:       string;
    attributes: Attributes;
    children:   Node[];
    next?:      Element;
    parent?:    Element;

//creation
    constructor(name: string, attributes?: Attributes, children?: Node[]);
    add(e: Node):           void;
    remove(e: Node):        boolean;
    setText(text: string):  void;

//child access
    get elements():         Record<string, Element>;
    firstElement():         Element | undefined;
    allElements():          Element[];
    firstText():            string | undefined;
    allText():              string[];

//output
    toString(options?: OutputOptions): string;
    setOptions(options: OutputOptions): this;
}

//example
const element = new xml.Element("root", { attr: "value" }, [
    new Comment("Child comment"),
    "some text",
    new xml.Element("Child"),
    new CDATA("Child CDATA"),
]);
```

### Node
A `xml.Node` is a child of an `Element`. It can be another `Element`, a `string`, or anything that provides a method `toString(options?: OutputOptions)`.
In particular, the following classes are provided:

```typescript
export class Comment {
	constructor(public comment: string) {}
}
```

```typescript
export class CDATA {
	constructor(public cdata: string) {}
}
```

```typescript
export class DocType {
	constructor(public doctype: string) {}
}
```

- `add(e: xml.Node)` adds a node to an `Element`.
- `remove(e: xml.Node)` removes a node from an `Element`.
- `setText(text: string)` sets the first `string` node to the given text (or adds it if none).


### Traversal
- `parent` is the parent `Element` of this `Element` (if any).
- `children` is an array of the child nodes in the order they were parsed from the xml file.
- `firstElement()` returns the first child that is an `Element` (if any).
- `allElements()` returns only the children that are `Element`s.
- `firstText()` returns the first child that is an `string` (if any).
- `allText()` returns only the children that are `string`s. Use `join` to combine them if necessary.

### By name

`elements` returns an object whose property names are the names of the `Node`'s child `Element`s. This allows for easy access to expected child Elements:
```typescript
const xmlString = `<root><child>Text</child></root>`;
const rootElement = xml.parse(xmlString);
const child = rootElement.elements.child;
console.log(child.children[0]); // prints 'Text'
```

Where there are multiple child nodes with the same name, accessing that property will return the first child of that name, but the rest can be recovered through the iterator defined on it (note: the first child is also returned by the iterator).

```typescript
const xmlString = `<root><child>Text1</child><child>Text2</child><child>Text3</child></root>`;
const rootElement = xml.parse(xmlString);
const child = rootElement.elements.child;
console.log(child.children[0]); // prints 'Text1'
//iterate over all <child> nodes - prints 'Text1', 'Text2', 'Text3'
for (const i of child)
    console.log(i.children[0]);

```


## Internals

### SAX
The `parse` function uses a simple SAX parser which can be used externally:
```typescript
export interface SaxOptions {
	onerror?: (e: Error) => boolean | void;
	ontext?: (t: string) => void;
	ondoctype?: (doctype: string) => void;
	onprocessing?: (name: string, body: string) => void;
	onopentag?: (tagName: string, attributes: Attributes) => void;
	onclosetag?: (tagName: string) => void;
	oncomment?: (comment: string) => void;
	oncdata?: (cdata: string) => void;
	entities?: Entities;
}
export function sax(xml: string, options: SaxOptions);
```

### EntityCreator
The `toString` function uses the `EntityCreator` helper class which substitutes characters for the given entities. This can be used externally, and can be provided directly to the `entities` property of `OutputOptions`.
```typescript
export class EntityCreator {
    constructor(entities: Entities, from?: EntityCreator);
    replace(text: string): string;
}
```

## License

This project is licensed under the MIT License.