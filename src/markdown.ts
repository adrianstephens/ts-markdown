/* eslint-disable no-control-regex */
//import {Node as xmlNode, OutputOptions, EntityCreator, Element, Attributes, reENTITY, decodeEntity, removeEntities, defaultEntities, defaultEntityCreator} from "@isopodlabs/xml"
import * as utils from "@isopodlabs/utilities";
import * as xml from "@isopodlabs/xml";

const CODE_INDENT		= 4;

export interface Reference {
	destination: string,
	title: string;
}

const ESCAPABLE				= "\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-";
const WHITESPACE			= " \t\n\x0b\x0c\x0d";
const TAGNAME   			= "[A-Za-z][A-Za-z0-9-]*";
const ATTRIBUTENAME	 		= "[a-zA-Z_:][a-zA-Z0-9:._-]*";
const UNQUOTEDVALUE	 		= "[^\"'=<>`\\x00-\\x20]+";
const SINGLEQUOTEDVALUE	 	= "'[^']*'";
const DOUBLEQUOTEDVALUE	 	= '"[^"]*"';
const ATTRIBUTEVALUE		= `(?:${UNQUOTEDVALUE}|${SINGLEQUOTEDVALUE}|${DOUBLEQUOTEDVALUE})`;
const ATTRIBUTEVALUESPEC	= `(?:\\s*=\\s*${ATTRIBUTEVALUE})`;
const ATTRIBUTE	 			= `(?:\\s+${ATTRIBUTENAME}${ATTRIBUTEVALUESPEC}?)`;
const OPENTAG				= `<${TAGNAME}${ATTRIBUTE}*\\s*/?>`;
const CLOSETAG				= `</${TAGNAME}\\s*[>]`;

const HTMLCOMMENT   		= "<!-->|<!--->|<!--[\\s\\S]*?-->";
const PROCESSINGINSTRUCTION	= "[<][?][\\s\\S]*?[?][>]";
const DECLARATION   		= "<![A-Za-z]+" + "[^>]*>";
const CDATA	 				= "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";

const reHtmlTag				= new RegExp(`^(?:${OPENTAG}|${CLOSETAG}|${HTMLCOMMENT}|${PROCESSINGINSTRUCTION}|${DECLARATION}|${CDATA})`);
const reLinkLabel 			= /^\[(?:[^\\[\]]|\\.){0,1000}\]/s;
const reSpnl 				= /^ *(?:\n *)?/;
const reLinkDestBraces 		= /^(?:<(?:[^<>\n\\\x00]|\\.)*>)/;

const reUnsafeProtocol		= /^javascript:|vbscript:|file:|data:/i;
const reSafeDataProtocol	= /^data:image\/(?:png|gif|jpeg|webp)/i;
export function potentiallyUnsafe(url: string) {
	return reUnsafeProtocol.test(url) && !reSafeDataProtocol.test(url);
}

function isEscapable(s: string) {
	return ESCAPABLE.includes(s);
}

function isWhitespace(s: string) {
	return WHITESPACE.includes(s);
}

function unescapeString(s: string) {
	const escapes = new RegExp("\\\\[" + ESCAPABLE + "]", "g");
	return xml.removeEntities(s.replace(escapes, s => s[1]), xml.defaultEntities);
}

function normalizeURI(uri: string) {
	return uri.replace(/(%[0-9A-Fa-f][0-9A-Fa-f])|[^;/?:@&=+$,-_.!~*'()#]+/g, (s, r) => r ? r : encodeURIComponent(s));
}

// normalize a reference in reference link (remove []s, trim, collapse internal space, unicode case fold.
function normalizeReference(s: string) {
	return s
		.slice(1)
		.trim()
		.replace(/[\t\r\n]+/g, " ")
		.toLowerCase()
		.toUpperCase();
}

function parseLinkDestination(parser: utils.StringParser) {
	const res = parser.match(reLinkDestBraces);
	if (res)
		return normalizeURI(unescapeString(res.slice(1, -1)));	// chop off surrounding <..>:

	if (parser.peek() === '<')
		return;

	// TODO handrolled parser; res should be null or the string
	const savepos = parser.pos;
	let openparens = 0;
	let c: string;
	while ((c = parser.peek())) {
		if (c === '\\' && isEscapable(parser.subject.charAt(parser.pos + 1))) {
			++parser.pos;
			if (parser.peek())
				++parser.pos;
		} else if (c === '(') {
			++parser.pos;
			++openparens;
		} else if (c === ')') {
			if (openparens < 1)
				break;
			++parser.pos;
			--openparens;
		} else {
			if (isWhitespace(c))
				break;
			++parser.pos;
		}
	}
	if (parser.pos > savepos && openparens === 0)
		return normalizeURI(unescapeString(parser.subject.slice(savepos, parser.pos)));
}

const ESCAPED_CHAR  = "\\\\[" + ESCAPABLE + "]";
const reLinkTitle = new RegExp(
	'^(?:"('		+ ESCAPED_CHAR + '|\\\\[^\\\\]' + '|[^\\\\"\\x00])*"'
	+ "|" + "'("	+ ESCAPED_CHAR + '|\\\\[^\\\\]' + "|[^\\\\'\\x00])*'"
	+ "|" + "\\(("	+ ESCAPED_CHAR + '|\\\\[^\\\\]' + "|[^\\\\()\\x00])*\\))"
);

function parseLinkTitle(parser: utils.StringParser) {
	const title = parser.match(reLinkTitle);
	return title ? unescapeString(title.slice(1, -1)) : title;			// chop off quotes from title and unescape:
}

//-----------------------------------------------------------------------------
//	Node
//-----------------------------------------------------------------------------

export class Text {
	parent?:	xml.Element;
	constructor(public literal: string) {}
	toString(options: xml.OutputOptions)	{
		return (options.entities as xml.EntityCreator).replace(this.literal);
	}
}

class Node extends xml.Element {
	get last()	{ return this.children.at(-1)!; }

	appendChild(node: NodeOrText)	{
		this.children.push(node);
		node.parent = this;
	}
}

type NodeOrText = Node | Text;

function unlink(me: NodeOrText)	{
	me.parent?.remove(me);
}

function nextSibling(me: NodeOrText) {
	const allsibs = me.parent!.children;
	return allsibs[allsibs.indexOf(me) + 1];
}
function insertAfter(me: NodeOrText, after: NodeOrText) {
	const parent = me.parent!;
	after.parent = parent;
	parent.children.splice(parent.children.indexOf(me), 0, after);
}

function extractSiblings(fromafter: NodeOrText, to?: NodeOrText) {
	const parent = fromafter.parent!;
	const index1 = parent.children.indexOf(fromafter);
	const index2 = to ? parent.children.indexOf(to) : parent.children.length;
	return parent!.children.splice(index1 + 1, index2 - index1 - 1) as Node[];
}
export function *walk(node: NodeOrText): Generator<NodeOrText> {
	yield node;
	if (node instanceof Node)
		for (const i of node.children)
			yield* walk(i as Node);
}

//-----------------------------------------------------------------------------
//	Inlines
//-----------------------------------------------------------------------------

type InlineStart = (parser: InlineParser) => boolean;

export class Inline extends Node {
	static registered: InlineStart[] = [];
	static register(char: string, fn: InlineStart) {
		this.registered[char.charCodeAt(0)] = fn;
	}
}

type Delimiter = "'" | '"' | '*' | '_' | '~';

interface Delimiters {
	cc:		 		Delimiter;
	numdelims:  	number;
	origdelims: 	number;
	node:	  		Text,
	previous?:		Delimiters,
	next?:			Delimiters,
	can_open:   	boolean,
	can_close:  	boolean
}

interface Brackets {
	node:			NodeOrText,
	previous?: 		Brackets,
	previousDelim?: Delimiters,
	index:			number,
	image:			boolean,
	active:			boolean;
	bracketAfter?:	boolean;
}

class HtmlInline extends Text {
	constructor(literal: string) {
		super(literal);
	}
	toString(options?: any)	{
		return options.safe ? "<!-- raw HTML omitted -->" : this.literal;
	}
}

class Code extends Inline {
	static {
		// Attempt to parse backticks, adding either a backtick code span or a literal sequence of backticks.
		const reTicks 		= /`+/;
		const reTicksHere 	= /^`+/;

		Inline.register('`', parser => {
			const ticks = parser.match(reTicksHere);
			if (!ticks)
				return false;

			const afterOpenTicks = parser.pos;
			let matched: string | undefined;
			while ((matched = parser.match(reTicks))) {
				if (matched === ticks) {
					const contents = parser.subject.slice(afterOpenTicks, parser.pos - ticks.length).replace(/\n/gm, " ");
					parser.appendChild(new Code(
						contents.length > 0 && contents.match(/[^ ]/) && contents[0] == " " && contents[contents.length - 1] == " "	? contents.slice(1) : contents
					));
					return true;
				}
			}
			// If we got here, we didn't match a closing backtick sequence.
			parser.pos = afterOpenTicks;
			parser.addText(ticks);
			return true;
		});
	}
	constructor(literal: string) {
		super("code");
		this.children.push(literal);
	}
}

class Link extends Inline {
	static {
		const reAutolink 		= /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/i;
		const reEmailAutolink	= /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
		Inline.register('<',	parser =>  {
			let m: string|undefined;
			if ((m = parser.match(reEmailAutolink))) {
				const dest = m.slice(1, -1);
				const node = new Link(normalizeURI("mailto:" + dest));
				node.appendChild(new Text(dest));
				parser.appendChild(node);
				return true;
		
			} else if ((m = parser.match(reAutolink))) {
				const dest = m.slice(1, -1);
				const node = new Link(normalizeURI(dest));
				node.appendChild(new Text(dest));
				parser.appendChild(node);
				return true;
		
			} else if ((m = parser.match(reHtmlTag))) {	// Attempt to parse a raw HTML tag.
				parser.appendChild(new HtmlInline(m));
				return true;
				
			} else {
				return false;
			}
		});
	}
	constructor(destination: string, title?: string) {
		super("a");
		this.attributes.href = destination;
		this.attributes.title = title;
	}
}

class Image extends Inline {
	constructor(public destination: string, public title?: string) {
		super("img");
		this.attributes.src = destination;
		this.attributes.title = title;
	}
	toString(options?: any)	{
		this.attributes.alt = this.children.map(element => element instanceof Text ? element.literal : '').join('');
		return super.toString(options);
	}
}

//-----------------------------------------------------------------------------
//	Inline Handlers
//-----------------------------------------------------------------------------

const reFinalSpace 		= / *$/;
const reInitialSpace 	= /^ */;

Inline.register('\n', parser => {
	++parser.pos;
	// check previous node for trailing spaces
	const lastc = parser.block.last;
	if (lastc && lastc instanceof Text && lastc.literal[lastc.literal.length - 1] === " ") {
		const hardbreak = lastc.literal[lastc.literal.length - 2] === " ";
		lastc.literal	= lastc.literal.replace(reFinalSpace, "");
		if (hardbreak)
			parser.appendChild(new Inline("br"));
		else
			parser.addText(parser.options.softbreak);
	} else {
		parser.addText(parser.options.softbreak);
	}
	parser.match(reInitialSpace); // gobble leading spaces in next line
	return true;
});

// Parse a backslash-escaped special character, adding either the escaped character, a hard line break (if the backslash is followed by a newline), or a literal backslash to the block's children.
Inline.register('\\', parser =>  {
	const subj = parser.subject;
	++parser.pos;
	if (parser.skip('\n')) {
		parser.appendChild(new Inline("br"));
	} else if (isEscapable(subj.charAt(parser.pos))) {
		return Inline.registered[0]?.(parser);
		//return Inline.registered[0]
		//parser.addText(subj.charAt(parser.pos++));
	} else {
		parser.addText("\\");
	}
	return true;
});

Inline.register('*',	parser => parser.handleDelim('*', parser.count('*')));
Inline.register('_',	parser => parser.handleDelim('_', parser.count('_')));
Inline.register('~',	parser => parser.handleDelim('~', parser.count('~')));
Inline.register("'",	parser => parser.options.smart && parser.handleDelim("'", (++parser.pos, 1)));
Inline.register('"',	parser => parser.options.smart && parser.handleDelim('"', (++parser.pos, 1)));

// Add open bracket to delimiter stack and add a text node to block's children.
Inline.register('[', 	parser => {
	const startpos = parser.pos++;

	const node = new Text("[");
	parser.appendChild(node);

	// Add entry to stack for this opener
	parser.addBracket(node, startpos, false);
	return true;
});

// Try to match close bracket against an opening in the delimiter stack.
// Add either a link or image, or a plain [ character, to block's children.
// If there is a matching delimiter, remove it from the delimiter stack.
Inline.register(']',	parser => {
	// get last [ or ![
	const opener = parser.brackets;
	if (!opener)
		return false;		// no matched opener, just return a literal

	if (!opener.active) {
		parser.removeBracket();		// take opener off brackets stack
		return false;
	}
	
	const startpos = ++parser.pos;

	// Inline link?
	let matched = false;
	let dest: string|undefined, title: string|undefined;
	if (parser.skip('(')) {
		parser.match(reSpnl);
		dest = parseLinkDestination(parser);
		if (dest) {
			parser.match(reSpnl);
			// make sure there's a space before the title:
			if (isWhitespace(parser.subject.charAt(parser.pos - 1)))
				title = parseLinkTitle(parser);
			parser.match(reSpnl);
			matched = parser.skip(')');
		}
		if (!matched) {
			// the [ was not a link after all, we're just missing the closing parenthesis
			parser.pos = startpos;
		}
	}

	if (!matched) {
		// Next, see if there's a link label
		let rawlabel = parser.match(reLinkLabel);
		// Empty or missing second label means to use the first label as the reference. The reference must not contain a bracket. If we know there's a bracket, we don't even bother checking it.
		if (!rawlabel || rawlabel.length <= 2)
			rawlabel = opener && !opener.bracketAfter ? parser.subject.slice(opener.index, startpos) : undefined;

		if (rawlabel) {
			// lookup rawlabel in refmap
			const link = parser.refmap[normalizeReference(rawlabel)];
			if (link) {
				dest	= link.destination;
				title	= link.title;
				matched = true;
			}
		}
	}

	if (opener && matched) {
		const node = opener.image ? new Image(dest!, title || "") : new Link(dest!, title);

		parser.flushText();

		const sibs = extractSiblings(opener.node);
		for (const i of sibs)
			node.appendChild(i);

		parser.appendChild(node);
		parser.processEmphasis(opener.previousDelim!);
		parser.removeBracket();
		unlink(opener.node);

		// We remove this bracket and processEmphasis will remove later delimiters.
		// Now, for a link, we also deactivate earlier link openers (no links in links)
		if (!opener.image) {
			for (let opener = parser.brackets; opener; opener = opener.previous) {
				if (!opener.image)
					opener.active = false; // deactivate this opener
			}
		}
		return true;
	}
	// no match
	parser.removeBracket(); // remove this opener from stack
	parser.pos = startpos;
	parser.addText(']');
	return true;
});

// IF next character is [, add ! delimiter to delimiter stack and add a text node to block's children
Inline.register('!',	parser => {
	const startpos = ++parser.pos;
	if (parser.skip('[')) {
		const node = new Text("![");
		parser.appendChild(node);
		parser.addBracket(node, startpos, true);		// Add entry to stack for this opener
	} else {
		parser.addText('!');
	}
	return true;
});

// Attempt to parse an entity
const reEntityHere 	= new RegExp("^" + xml.reENTITY.source, "i");
Inline.register('&',	parser => {
	const m = parser.exec(reEntityHere);
	if (m) {
		parser.addText(xml.decodeEntity(xml.defaultEntities, ...m));
		return true;
	}
	return false;
});

// Check for ellipsis
const reEllipses 	= /\.\.\./g;
Inline.register('.',	parser => parser.options.smart && parser.match(reEllipses) ? parser.addText("\u2026") : false);

// Check for dashes
const reDash 		= /--+/g;
Inline.register('-',	parser => {
	if (parser.options.smart) {
		const m = parser.match(reDash);
		if (m) {
			const length = m[0].length;
			const mod3 = length % 3;
			const emCount = length % 2 == 0 ? 0 : length / 3 - (mod3 === 1 ? 1 : 0);
			const enCount = length % 2 == 0 ? length / 2 : mod3 === 1 ? 2 : mod3 === 2 ? 1 : 0;
			parser.addText("\u2014".repeat(emCount) + "\u2013".repeat(enCount));
			return true;
		}
	}
	return false;
});

//-----------------------------------------------------------------------------
//	InlineParser
//-----------------------------------------------------------------------------
const rePunctuation		= /^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~\p{P}\p{S}]/u;
const reWhitespace 		= /^\s/;

export class InlineParser extends utils.StringParser {
	block!:			Block;
	delimiters?:	Delimiters;
	brackets?:		Brackets;
	build			= '';

	constructor(public options: any, public refmap:	Record<string, Reference>) {
		super('');
	}

	addText(s: string) {
		this.build += s;
		return true;
	}
	flushText() {
		if (this.build) {
			this.block?.appendChild(new Text(this.build));
			this.build = '';
		}
	}

	appendChild(child: NodeOrText) {
		this.flushText();
		this.block?.appendChild(child);
	}

	count(cc: string) {
		let n = 0;
		while (this.skip(cc))
			++n;
		return n;
	}

	// Scan a sequence of characters with code cc, and return information about the number of delimiters and whether they are positioned such that they can open and/or close emphasis or strong emphasis
	// Handle a delimiter marker for emphasis or a quote
	handleDelim(cc: Delimiter, numdelims: number) {

		const char_before		= utils.previousChar(this.subject, this.pos - numdelims);
		const char_after		= this.peek() || '\n';

		const before_white		= reWhitespace.test(char_before);
		const before_punc		= rePunctuation.test(char_before);
		const after_whites		= reWhitespace.test(char_after);
		const after_punc		= rePunctuation.test(char_after);

		const left_flanking		= !after_whites && (!after_punc || before_white || before_punc);
		const right_flanking	= !before_white && (!before_punc || after_whites || after_punc);

		let can_open: boolean, can_close: boolean;
		if (cc === "'" || cc === '"') {
			can_open	= left_flanking && !right_flanking;
			can_close	= right_flanking;
		} else if (cc === '_') {
			can_open	= left_flanking && (!right_flanking || before_punc);
			can_close	= right_flanking && (!left_flanking || after_punc);
		} else  {//'*' or '~'
			can_open	= left_flanking;
			can_close	= right_flanking;
		}

		const contents	= cc === "'" ? "\u2019"
						: cc === '"' ? "\u201C"
						: this.subject.slice(this.pos - numdelims, this.pos);

		const node		= new Text(contents);
		this.appendChild(node);

		// Add entry to stack for this opener
		if (can_open || can_close) {
			this.addDelimiter({
				cc,
				numdelims,
				origdelims:	numdelims,
				node,
				can_open,
				can_close
			});
		}

		return true;
	}

	addDelimiter(delim: Delimiters) {
		delim.previous = this.delimiters;
		if (this.delimiters)
			this.delimiters.next = delim;
		this.delimiters = delim;
	}
	removeDelimiter(delim: Delimiters) {
		if (delim.previous)
			delim.previous.next = delim.next;
		if (!delim.next)
			this.delimiters = delim.previous; // top of stack
		else
			delim.next.previous = delim.previous;
	}

	processEmphasis(stack_bottom?: Delimiters) {
		const openers_bottom = Array.from({length: 20}, () => stack_bottom);
		
		// find first closer above stack_bottom:
		let closer = this.delimiters;
		while (closer && closer.previous !== stack_bottom)
			closer = closer.previous;

		// move forward, looking for closers, and handling each
		while (closer) {
			const closercc = closer.cc;
			if (!closer.can_close) {
				closer = closer.next;

			} else {
				// found emphasis closer. now look back for first matching opener:
				const index	= closercc == "'" ? 0
							: closercc == '"' ? 1
							: closercc == '_' ? 2 + (closer.can_open ? 3 : 0) + (closer.origdelims % 3)
							: closercc == '*' ? 8 + (closer.can_open ? 3 : 0) + (closer.origdelims % 3)
							: 14 + (closer.can_open ? 3 : 0) + (closer.origdelims % 3);	//~

				let opener			= closer.previous;
				let opener_found	= false;
				while (opener && opener !== stack_bottom && opener !== openers_bottom[index]) {
					const odd_match = (closer.can_open || opener.can_close) && closer.origdelims % 3 !== 0 && (opener.origdelims + closer.origdelims) % 3 === 0;
					if (opener.cc === closer.cc && opener.can_open && !odd_match) {
						opener_found = true;
						break;
					}
					opener = opener.previous;
				}

				const old_closer = closer;

				if (closercc === "'") {
					closer.node.literal = "\u2019";
					if (opener_found && opener)
						opener.node.literal = "\u2018";
					closer = closer.next;
				} else if (closercc === '"') {
					closer.node.literal = "\u201D";
					if (opener_found && opener)
						opener.node.literal = "\u201C";
					closer = closer.next;
				} else {
					//closercc === '*' or '_' or '~'
					if (!opener || !opener_found) {
						closer = closer.next;
					} else {
						// calculate actual number of delimiters used from closer
						const use_delims = closer.numdelims >= 2 && opener.numdelims >= 2 ? 2 : 1;

						const opener_inl = opener.node;
						const closer_inl = closer.node;

						// remove used delimiters from stack elts and inlines
						opener.numdelims -= use_delims;
						closer.numdelims -= use_delims;

						opener_inl.literal = opener_inl.literal.slice(0, opener_inl.literal.length - use_delims);
						closer_inl.literal = closer_inl.literal.slice(0, closer_inl.literal.length - use_delims);

						const emph = new Inline(closercc === '~' ? "del" : use_delims === 1 ? "em" : "strong");
						const sibs = extractSiblings(opener_inl, closer_inl);
						for (const i of sibs)
							emph.appendChild(i);
						insertAfter(opener_inl, emph);

						// remove elements between opener and closer
						if (opener.next !== closer) {
							opener.next = closer;
							closer.previous = opener;
						}

						// if opener has 0 delims, remove it and the inline
						if (opener.numdelims === 0) {
							unlink(opener_inl);
							this.removeDelimiter(opener);
						}

						if (closer.numdelims === 0) {
							unlink(closer_inl);
							const tempstack = closer.next;
							this.removeDelimiter(closer);
							closer = tempstack;
						}
					}
				}

				if (!opener_found) {
					// Set lower bound for future searches for openers:
					openers_bottom[index] = old_closer.previous;
					if (!old_closer.can_open)
						this.removeDelimiter(old_closer);	// We can remove a closer that can't be an opener once we've seen there's no matching opener
				}
			}
		}

		// remove all delimiters
		while (this.delimiters && this.delimiters !== stack_bottom)
			this.removeDelimiter(this.delimiters);
	}

	addBracket(node: NodeOrText, index: number, image: boolean) {
		if (this.brackets)
			this.brackets.bracketAfter = true;

		this.brackets = {
			node,
			previous: 		this.brackets,
			previousDelim:	this.delimiters,
			index,
			image,
			active: true
		};
	}

	removeBracket() {
		this.brackets = this.brackets?.previous;
	}

	// Parse string content in block into inline children
	parseInlines(block: Block) {
		this.block		= block;
		this.subject	= block.string_content.trim();
		this.pos		= 0;
		this.delimiters = undefined;
		this.brackets 	= undefined;
		this.build		= '';

		block.string_content = '';

		while (this.remainder()) {
			const c = this.subject.charCodeAt(this.pos);
			const res = Inline.registered[c]?.(this);
			if (!res)
				this.addText(this.subject[this.pos++]);
		}

		this.flushText();
		this.processEmphasis(undefined);

		let prevtext: Text | undefined;
		const children = this.block.children;
		this.block.children = [];
		for (const child of children) {
			if (child instanceof Text) {
				if (prevtext) {
					prevtext.literal += child.literal;
					continue;
				}
				prevtext = child;
			}
			this.block.children.push(child);
		}
	}
}

//-----------------------------------------------------------------------------
//	Blocks
//-----------------------------------------------------------------------------

const reNonSpace		= /[^ \t\f\v\r\n]/;
const reMaybeSpecial	= /^[#`~*+_=<>0-9-|]/;
const reLineEnding		= /\r\n|\n|\r/;

function isSpaceOrTab(c: string) {
	return c === ' ' || c === '\t';
}

// 0 = no match
// 1 = matched container, keep going
// 2 = matched leaf, no more block starts
type BlockStart = (parser:BlockParser, container:Block)=>number;

class SourcePos {
	constructor(public line: number, public col: number) {}
	add(lines: number, cols: number) { return new SourcePos(this.line + lines, this.col + cols); }
	toString() { return `${this.line}:${this.col}`; }
}

class SourceRange {
	constructor(public start: SourcePos, public end = new SourcePos(0, 0)) {}
	toString() { return `${this.start}-${this.end}`; }
}

export class Block extends Node {
	string_content	= '';

	static registered : {start: BlockStart, priority: number}[] = [];

	static register(start: BlockStart, priority = 0) {
		const i = this.registered.findIndex(i => i.priority < priority);
		this.registered.splice(i, 0, {start, priority});
	}

	
	//run when the block is closed.
	finalize(_parser: BlockParser)	{}

	// check whether the block is continuing at a certain line and offset (e.g. whether a block quote contains a `>`)
	// 0 = matched
	// 1 = not matched
	// 2 = we've dealt with this line completely, go to next
	continue(_parser: BlockParser)	{ return 0; }
	canContain(_t: string)			{ return false; }
	acceptsLines() 					{ return false; }

	constructor(type: string, pos: SourcePos) {
		super(type);
		this.attributes['data-sourcepos'] = new SourceRange(pos);
	}

	get sourcepos() { return this.attributes['data-sourcepos']; }
	
	get open() {
		return this.sourcepos.end.line === 0;
	}
}

//-----------------------------------------------------------------------------
//	Block Parser
//-----------------------------------------------------------------------------

export class BlockParser extends utils.StringParser {
	doc						= new Document;
	tip:			Block	= this.doc;
	oldtip:			Block	= this.doc;
	lastMatched?:	Block	= this.doc;
	lineNumber	 			= 0;
	lastLineLength	 		= 0;
	column	 				= 0;
	nextNonspace   			= 0;
	nextNonspaceColumn	 	= 0;
	indent	 				= 0;
	blank  					= false;
	partiallyConsumedTab   	= false;
	allClosed  				= true;
	refmap: Record<string, Reference> = {};

	constructor(public options: any = {}) {
		super('');
		this.options.softbreak = this.options.softbreak || "\n";
	}

	get indented()	{
		return this.indent >= CODE_INDENT;
	}

	nonSpace() {
		return this.subject.slice(this.nextNonspace);
	}

	advanceNextNonspace() {
		this.pos	= this.nextNonspace;
		this.column = this.nextNonspaceColumn;
		this.partiallyConsumedTab = false;
	}
	
	findNextNonspace() {
		const currentLine = this.subject;
		let i		= this.pos;
		let cols	= this.column;
		let c;
	
		while ((c = currentLine.charAt(i)) !== "") {
			if (c === " ") {
				i++;
				cols++;
			} else if (c === "\t") {
				i++;
				cols += 4 - (cols % 4);
			} else {
				break;
			}
		}
		this.blank 				= c === "\n" || c === "\r" || c === "";
		this.nextNonspace		= i;
		this.nextNonspaceColumn = cols;
		this.indent				= this.nextNonspaceColumn - this.column;
	}
	
	// Analyze a line of text and update the document appropriately
	private incorporateLine(ln: string) {
		this.oldtip 	= this.tip;
		this.pos 		= 0;
		this.column 	= 0;
		this.blank 		= false;
		this.partiallyConsumedTab = false;
		++this.lineNumber;
	
		// replace NUL characters for security
		ln = ln.replace(/\0/g, "\uFFFD");
	
		this.subject	= ln;
	
		// For each containing block, try to parse the associated line start
		// Bail out on failure: container will point to the last matching block
		
		let lastChild;
		let container: Block = this.doc;

		while ((lastChild = container.last as Block) && lastChild.open) {
			this.findNextNonspace();
	
			const cont = lastChild.continue(this);
			if (cont === 2)	// we've hit end of line for fenced code close and can return
				return;

			if (cont === 1)	// we've failed to match a block
				break;

			//we've matched, keep going
			container = lastChild;
		}
	
		this.allClosed				= container === this.oldtip;
		this.lastMatched	= container;
	
		// Unless last matched container is a code block, try new container starts, adding children to the last matched container:
		for (let matchedLeaf = !(container instanceof Paragraph) && container.acceptsLines(); !matchedLeaf; ) {
			this.findNextNonspace();
	
			// this is a little performance optimization:
			if (!this.indented && !reMaybeSpecial.test(this.nonSpace())) {
				this.advanceNextNonspace();
				break;
			}
	
			let matched = false;
			for (const i of Block.registered) {
				const res = i.start(this, container!);
				if (res) {
					container	= this.tip;
					matched 	= true;
					matchedLeaf	= res > 1;
					break;
				}
			}
	
			if (!matched) {
				// nothing matched
				this.advanceNextNonspace();
				break;
			}
		}
	
		// What remains at the offset is a text line; add the text to the appropriate container
	
		// First check for a lazy paragraph continuation:
		if (!this.allClosed && !this.blank && this.tip instanceof Paragraph) {
			// lazy paragraph continuation
			this.addLine();
			
		} else {
			// not a lazy continuation - finalize any blocks not matched
			this.closeUnmatchedBlocks();
	
			if (container.acceptsLines()) {
				this.addLine();
				// if HtmlBlock, check for end condition
				if (container instanceof HtmlBlock && container._htmlBlockClose && container._htmlBlockClose.test(this.remainder())) {
					this.lastLineLength = ln.length;
					this.finalize(container, this.lineNumber);
				}
			} else if (this.pos < ln.length && !this.blank) {
				// create paragraph container for line
				this.addChild(new Paragraph(this.currentPos()));
				this.advanceNextNonspace();
				this.addLine();
			}
		}
		this.lastLineLength = ln.length;
	}
	
	// Finalize a block.
	// Close it and do any necessary postprocessing, e.g. creating string_content from strings, setting the 'tight' or 'loose' status of a list, and parsing the beginningsof paragraphs for reference definitions.
	finalize(block: Block, lineNumber: number) {
		const above = block.parent;
		block.sourcepos.end = new SourcePos(lineNumber, this.lastLineLength);
	
		block.finalize(this);
	
		// Reset the tip to the parent of the closed block.
		this.tip = above as Block;
	}

	// Add a line to the block at the tip.  We assume the tip can accept lines -- that check should be done before calling this.
	addLine() {
		if (this.partiallyConsumedTab) {
			++this.pos; // skip over tab
			this.tip.string_content += " ".repeat(4 - (this.column % 4));
		}
		this.tip.string_content += this.remainder() + "\n";
	}

	currentPos() {
		return new SourcePos(this.lineNumber, this.pos + 1);
	}
	nextPos() {
		return new SourcePos(this.lineNumber, this.nextNonspace + 1);
	}

	// Add block of type tag as a child of the tip.  If the tip can't accept children, close and finalize it and try its parent, and so on til we find a block that can accept children.
	addChild(newBlock: Block) {
		while (!this.tip.canContain(newBlock.name))
			this.finalize(this.tip, this.lineNumber - 1);

		this.tip.appendChild(newBlock);
		this.tip = newBlock;
		return newBlock;
	}

	// Finalize and close any unmatched blocks.
	closeUnmatchedBlocks() {
		if (!this.allClosed) {
			// finalize any blocks not matched
			while (this.oldtip !== this.lastMatched) {
				const parent = this.oldtip!.parent as Block;
				this.finalize(this.oldtip!, this.lineNumber - 1);
				this.oldtip = parent;
			}
			this.allClosed = true;
		}
	}

	advanceOffset(count: number, columns = false) {
		let c: string;
		while (count > 0 && (c = this.peek())) {
			if (c === "\t") {
				const charsToTab = 4 - (this.column % 4);
				if (columns) {
					this.partiallyConsumedTab = charsToTab > count;
					const charsToAdvance = charsToTab > count ? count : charsToTab;
					this.column += charsToAdvance;
					this.pos	+= this.partiallyConsumedTab ? 0 : 1;
					count		-= charsToAdvance;
				} else {
					this.partiallyConsumedTab = false;
					this.column += charsToTab;
					++this.pos;
					--count;
				}
			} else {
				this.partiallyConsumedTab = false;
				++this.pos;
				++this.column; // assume ascii; block starts are ascii
				--count;
			}
		}
	}

	parse(input: string) {
		const lines = input.split(reLineEnding);
		
		// ignore last blank line created by final newline
		if (!lines.at(-1))
			lines.pop();

		for (const i of lines)
			this.incorporateLine(i);

		while (this.tip)
			this.finalize(this.tip, lines.length);

		// Walk through a block & children recursively, parsing string content into inline content where appropriate.
		const inlineParser	= new InlineParser(this.options, this.refmap);
		for (const node of walk(this.doc)) {
			const block = node as Block;
			if (block.string_content)
				inlineParser.parseInlines(block);
		}

		//const ok =this.doc.verify();
		return this.doc;
	}
}

//-----------------------------------------------------------------------------
//	Block types
//-----------------------------------------------------------------------------

const reSpaceAtEndOfLine 		= /^ *(?:\n|$)/;

function parseReference(parser: utils.StringParser) {
	// label:
	const rawlabel = parser.match(reLinkLabel);
	if (!rawlabel || rawlabel.length > 1001)
		return;

	if (!parser.skip(':'))
		return;
	parser.match(reSpnl);

	//  link url
	const destination = parseLinkDestination(parser);
	if (!destination)
		return;

	const beforetitle = parser.pos;
	let title = parser.match(reSpnl) && parseLinkTitle(parser);
	if (!title)
		parser.pos = beforetitle;			// rewind before spaces

	// make sure we're at line end:
	let atLineEnd = true;
	if (!parser.match(reSpaceAtEndOfLine)) {
		if (!title) {
			atLineEnd = false;
		} else {
			// the potential title we found is not at the line end, but it could still be a legal link reference if we discard the title
			title = undefined;
			parser.pos = beforetitle;
			// and instead check if the link URL is at the line end
			atLineEnd = !!parser.match(reSpaceAtEndOfLine);
		}
	}

	if (!atLineEnd)
		return;

	const label = normalizeReference(rawlabel);
	if (label)		// label must contain non-whitespace characters
		return {label, destination, title};
}

class Document extends Block {
	constructor() {
		super("body", new SourcePos(1, 1));
	}
	finalize(parser: BlockParser) {
		// Remove link reference definitions from given tree.
		const emptyNodes: Node[]	= [];

		for (const node of walk(this)) {
			if (node instanceof Paragraph) {
				const para = node as Paragraph;
				// Note that link reference definitions must be the beginning of a paragraph node since link reference definitions cannot interrupt paragraphs
				const parser2 = new utils.StringParser(para.string_content);
				let hasReferenceDefs = false;
				while (parser2.peek() === '[') {
					const savepos	= parser2.pos;
					const result	= parseReference(parser2);
					if (!result) {
						parser2.pos = savepos;
						break;
					}
					parser.refmap[result.label] ??= { destination: result.destination, title: result.title || ''};
					hasReferenceDefs = true;
				}

				para.sourcepos.start.line += parser2.processed().split("\n").length - 1;
				para.string_content = parser2.remainder();

				if (hasReferenceDefs && !reNonSpace.test(para.string_content))
					emptyNodes.push(para);
			}
		}

		for (const node of emptyNodes)
			unlink(node);
	}
	canContain(type: string) {
		return type !== "li";
	}
}

const reListMarker	= /^(?:[*+-]|(\d{1,9})([.)]))(?=\s|$)/;

class ListData {
	type			= '';
	tight			= true; // lists are tight by default
	bulletChar		= '';
	start			= 0;
	delimiter		= '';
	padding			= 0;
	constructor(public markerOffset: number) {}

	endcol() { return this.markerOffset + this.padding; }

	matches(that: ListData) {
		return	this.type 		=== that.type
			&&	this.delimiter	=== that.delimiter
			&&	this.bulletChar === that.bulletChar;
	}

	static parseListMarker(parser: BlockParser, paragraph: boolean) : ListData | undefined {
		const match = parser.nonSpace().match(reListMarker);
	// if it interrupts paragraph, make sure first line isn't blank
		if (match && (!paragraph || parser.subject.slice(parser.nextNonspace + match[0].length).match(reNonSpace))) {
			const data	= new ListData(parser.indent);
			if (match[1]) {
				data.type 		= "ordered";
				data.start 		= parseInt(match[1]);
				data.delimiter	= match[2];
			} else {
				data.type 		= "bullet";
				data.bulletChar = match[0][0];
			}

			// we've got a match! advance offset and calculate padding
			parser.advanceNextNonspace(); // to start of marker
			parser.advanceOffset(match[0].length, true); // to end of marker
			const spacesStartCol	= parser.column;
			const spacesStartOffset	= parser.pos;
			do {
				parser.advanceOffset(1, true);
			} while (parser.column - spacesStartCol < 5 && isSpaceOrTab(parser.peek()));

			const blank_item = !parser.peek();
			const spaces_after_marker = parser.column - spacesStartCol;
			if (spaces_after_marker >= 5 || spaces_after_marker < 1 || blank_item) {
				data.padding	= match[0].length + 1;
				parser.column	= spacesStartCol;
				parser.pos		= spacesStartOffset;
				if (isSpaceOrTab(parser.peek()))
					parser.advanceOffset(1, true);
			} else {
				data.padding = match[0].length + spaces_after_marker;
			}
			return data;
		}
	}
}

function endsWithBlankLine(node: Block) {
	const sib = nextSibling(node);
	return sib && node.sourcepos.end.line !== (sib as Block).sourcepos.start.line - 1;
}

export class ListNode extends Block {
	static { this.register((parser, container) => {
		if (!parser.indented || container instanceof ListNode) {
			const data = ListData.parseListMarker(parser, container.name === 'paragraph');
			if (data) {
				parser.closeUnmatchedBlocks();

				// add the list if needed
				if (!(parser.tip instanceof ListNode) || !(container as ListNode).listData.matches(data)) {
					container = new ListNode(parser.nextPos(), data);
					parser.addChild(container);
				}

				// add the list item
				parser.addChild(new ItemNode(parser.nextPos(), data));
				return 1;
			}
		}
		return 0;
	});}

	constructor(pos: SourcePos, public listData: ListData) {
		super(listData.type === "bullet" ? "ul" : "ol", pos);
		const start	= listData.start;
		if (start && start !== 1)
			this.attributes.start = start.toString();
	}
	finalize() {
		for (const item of this.children as Block[]) {
			// check for non-final list item ending with blank line
			if (endsWithBlankLine(item as Block)) {
				this.listData.tight = false;
				break;
			}
			// recurse into children of list item, to see if there are spaces between any of them
			for (const subitem of item.children) {
				if (endsWithBlankLine(subitem as Block)) {
					this.listData.tight = false;
					break;
				}
			}
		}
		this.sourcepos.end = (this.last as Block).sourcepos.end;
	}
	canContain(type: string) {
		return type === "li";
	}
}

class ItemNode extends Block {
	constructor(pos: SourcePos, public listData: ListData) {
		super("li", pos);
	}
	continue(parser: BlockParser) {
		if (parser.blank) {
			if (this.children.length === 0)
				return 1;	// Blank line after empty list item
			parser.advanceNextNonspace();
		} else if (parser.indent >= this.listData.endcol()) {
			parser.advanceOffset(this.listData.endcol(), true);
		} else {
			return 1;
		}
		return 0;
	}
	finalize() {
		if (this.last) {
			this.sourcepos.end		= (this.last as Block).sourcepos.end;
		} else {
			// Empty list item
			this.sourcepos.end.line = this.sourcepos.start.line;
			this.sourcepos.end.col	= this.listData.endcol();
		}
	}
	canContain(type: string) {
		return type !== "li";
	}
}

class Heading extends Block {
	static {
		// ATX heading
		const reATXHeadingMarker	= /^#{1,6}(?:[ \t]+|$)/;
		this.register(parser => {
			let match: RegExpMatchArray | null;
			if (!parser.indented && (match = parser.nonSpace().match(reATXHeadingMarker))) {
				parser.advanceNextNonspace();
				parser.advanceOffset(match[0].length, false);
				parser.closeUnmatchedBlocks();
				const container = parser.addChild(new Heading(parser.nextPos(), match[0].trim().length));
				// remove trailing ###s:
				container.string_content = parser.remainder()
					.replace(/^[ \t]*#+[ \t]*$/, "")
					.replace(/[ \t]+#+[ \t]*$/, "");
				parser.advanceOffset(parser.subject.length - parser.pos);
				return 2;
			}
			return 0;
		});

		// Setext heading
		const reSetextHeadingLine	= /^(?:=+|-+)[ \t]*$/;
		this.register((parser, container) => {
			let match: RegExpMatchArray | null;
			if (!parser.indented && container instanceof Paragraph && (match = parser.nonSpace().match(reSetextHeadingLine))) {
				parser.closeUnmatchedBlocks();

				// resolve reference link definitiosn
				const parser2 = new utils.StringParser(container.string_content);
				container.string_content = '';

				while (parser2.peek() === '[') {
					const result = parseReference(parser2);
					if (!result)
						break;
					parser.refmap[result.label] ??= { destination: result.destination, title: result.title || ''};
				}

				if (parser2.remaining()) {
					const heading = new Heading(container.sourcepos.start, match[0][0] === "=" ? 1 : 2);
					heading.string_content = parser2.remainder();
					insertAfter(container, heading);
					unlink(container);
					parser.tip = heading;
					parser.advanceOffset(parser.subject.length - parser.pos, false);
					return 2;
				}
			}
			return 0;
		});
	}

	constructor(pos: SourcePos, level: number) {
		super("h" + level, pos);
	}
	continue()		{ return 1; }		// a heading can never contain > 1 line, so fail to match:
}

class BlockQuote extends Block {
	static { this.register(parser => {
		if (!parser.indented && parser.subject[parser.nextNonspace] === '>') {
			parser.advanceNextNonspace();
			parser.advanceOffset(1, false);

			// optional following space
			if (isSpaceOrTab(parser.peek()))
				parser.advanceOffset(1, true);

			parser.closeUnmatchedBlocks();
			parser.addChild(new BlockQuote(parser.nextPos()));
			return 1;
		}
		return 0;
	});}
	
	constructor(pos: SourcePos) {
		super("blockquote", pos);
	}
	continue(parser: BlockParser) {
		if (!parser.indented && parser.subject[parser.nextNonspace] === '>') {
			parser.advanceNextNonspace();
			parser.advanceOffset(1, false);
			if (isSpaceOrTab(parser.peek()))
				parser.advanceOffset(1, true);
			return 0;
		}
		return 1;
	}
	canContain(type: string) { return type !== "li"; }
}

class ThematicBreak extends Block {
	static {
		const reThematicBreak		= /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
		this.register(parser => {
		if (!parser.indented && reThematicBreak.test(parser.nonSpace())) {
			parser.closeUnmatchedBlocks();
			parser.addChild(new ThematicBreak(parser.nextPos()));
			parser.advanceOffset(parser.subject.length - parser.pos, false);
			return 2;
		}
		return 0;
	});}

	constructor(pos: SourcePos) {
		super("hr", pos);
	}
	continue()		{ return 1; }		// a thematic break can never contain > 1 line, so fail to match:
}

export interface Fence {
	char:			string,
	length:			number,
	offset:			number,
}

const reClosingCodeFence	= /^(?:`{3,}|~{3,})(?=[ \t]*$)/;

class CodeBlock extends Block {
	static {
	// fenced code block
		const reCodeFence	= /^`{3,}(?!.*`)|^~{3,}/;
		this.register(parser => {
			let match: RegExpMatchArray | null;
			if (!parser.indented && (match = parser.nonSpace().match(reCodeFence))) {
				const fenceLength	= match[0].length;
				parser.closeUnmatchedBlocks();
				parser.addChild(new CodeBlock(parser.nextPos(), {length: fenceLength, char: match[0][0], offset: parser.indent}));
				parser.advanceNextNonspace();
				parser.advanceOffset(fenceLength, false);
				return 2;
			}
			return 0;
		});
	// indented code block
		this.register(parser => {
			if (parser.indented && !(parser.tip instanceof Paragraph) && !parser.blank) {
				// indented code
				parser.advanceOffset(CODE_INDENT, true);
				parser.closeUnmatchedBlocks();
				parser.addChild(new CodeBlock(parser.currentPos()));
				return 2;
			}
			return 0;
		});
	}

	literal = '';
	info	= '';

	constructor(pos: SourcePos, public fence?: Fence) {
		super("code_block", pos);
	}

	continue(parser: BlockParser) {
		const indent	= parser.indent;
		if (this.fence) {
			// fenced
			const match = indent <= 3 && parser.subject[parser.nextNonspace] === this.fence.char && parser.nonSpace().match(reClosingCodeFence);
			if (match && match[0].length >= this.fence.length) {
				// closing fence - we're at end of line, so we can return
				parser.lastLineLength = parser.pos + indent + match[0].length;
				parser.finalize(this, parser.lineNumber);
				return 2;
			} else {
				// skip optional spaces of fence offset
				for (let i = this.fence.offset; i > 0 && isSpaceOrTab(parser.peek()); --i)
					parser.advanceOffset(1, true);
			}
		} else {
			// indented
			if (indent >= CODE_INDENT) {
				parser.advanceOffset(CODE_INDENT, true);
			} else if (parser.blank) {
				parser.advanceNextNonspace();
			} else {
				return 1;
			}
		}
		return 0;
	}

	finalize() {
		if (this.fence) {
			// fenced; first line becomes info string
			const newline	= this.string_content.indexOf("\n");
			this.info 		= unescapeString(this.string_content.slice(0, newline).trim());
			this.children.push(this.string_content.slice(newline + 1));
		} else {
			// indented
			const lines		= this.string_content.split("\n");
			while (/^[ \t]*$/.test(lines[lines.length - 1]))
				lines.pop();
			this.children.push(lines.join("\n") + "\n");
			this.sourcepos.end = this.sourcepos.start.add(lines.length - 1, lines[lines.length - 1].length - 1);
		}
		const info_words	= this.info ? this.info.split(/\s+/) : [];

		if (info_words.length > 0 && info_words[0].length > 0) {
			let cls = info_words[0];
			if (!/^language-/.exec(cls))
				cls = "language-" + cls;
			this.attributes.class = cls;
		}
		this.string_content = '';
	}
	acceptsLines()	{ return true; }
	toString(options: any) {
		return `<pre>${super.toString(options)}</pre>`;
	}
}

class HtmlBlock extends Block {
	static { 
		const reHtmlBlocks = [
			[/^<(?:script|pre|textarea|style)(?:\s|>|$)/i,	/<\/(?:script|pre|textarea|style)>/i],
			[/^<!--/,			/-->/,	],
			[/^<[?]/,			/\?>/	],
			[/^<![A-Za-z]/,		/>/		],
			[/^<!\[CDATA\[/,	/\]\]>/	],
			[/^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i],
		];
		
		const reHtmlBlocks7 = new RegExp(`^(?:${OPENTAG}|${CLOSETAG})\\s*$`, "i");

		this.register(parser => {
			if (!parser.indented && parser.subject[parser.nextNonspace] === '<') {
				const s = parser.nonSpace();
				for (const blockType of reHtmlBlocks) {
					if (blockType[0].test(s)) {
						parser.closeUnmatchedBlocks();
						// We don't adjust parser.offset; spaces are part of the HTML block:
						parser.addChild(new HtmlBlock(parser.currentPos(), blockType[1]));
						return 2;
					}
				}
		
				if (!(parser.tip instanceof Paragraph) && !(!parser.allClosed && !parser.blank && parser.tip instanceof Paragraph) && reHtmlBlocks7.test(s)) {
					parser.addChild(new HtmlBlock(parser.currentPos()));
					parser.closeUnmatchedBlocks();
					return 2;
				}
			}

			return 0;
		});
	}

	literal = '';

	constructor(pos: SourcePos, public _htmlBlockClose?: RegExp) {
		super("html_block", pos);
	}

	continue(parser: BlockParser) {
		return parser.blank && !this._htmlBlockClose ? 1 : 0;
	}
	finalize() {
		this.literal = this.string_content.replace(/\n$/, '');
		this.string_content = ''; // allow GC
	}
	acceptsLines()	{ return true; }
	toString(options: any) {
		return options.safe ? "<!-- raw HTML omitted -->" : this.literal;
	}
}

class Paragraph extends Block {
	constructor(pos: SourcePos, text?: string) {
		super("p", pos);
		this.string_content = text ?? '';
	}
	continue(parser: BlockParser) {
		return parser.blank ? 1 : 0;
	}
	acceptsLines()	{ return true; }
	toString(options: any) {
		const grandparent = this.parent?.parent;
		if (grandparent && grandparent instanceof ListNode) {
			if (grandparent.listData?.tight)
				return this.children.map(i => i.toString(options)).join('');
		}
		return super.toString(options);
	}
}

class TableItem extends Node {
	string_content: string;
	constructor(type: string, text?: string, align?:number) {
		super(type);
		this.string_content = text ?? '';
		if (align)
			this.attributes.style = "text-align: right;";

	}
}

function splitline(line: string) {
	const items = line.split('|');
	if (!items.at(-1))
		items.pop();
	if (!items[0])
		items.shift();
	return items;
}
function putrow(row: TableItem, line: string, type: string, flags: number[]) {
	const items = splitline(line);
	let x = 0;
	for (const i of items)
		row.appendChild(new TableItem(type, i, flags[x++]));
}

class Table extends Block {
	static {
		const reTableHeadingLine	= /^\|?(?:(:?)(?:-+)(:?)\|)+(?:(:?)(?:-+)(:?))?$/;
		this.register((parser, container) => {
			let match: RegExpMatchArray | null;
			if (!parser.indented && container instanceof Paragraph && (match = parser.nonSpace().match(reTableHeadingLine))) {

				const heads		= splitline(container.string_content.slice(0, -1));
				const delims	= splitline(parser.nonSpace());
				if (heads.length != delims.length)
					return 1;
	
				//check delimiter row
				const reFlags = /^(:?)(?:-+)(:?)$/;
				const headerflags: number[] = [];

				for (const i of delims) {
					const m = reFlags.exec(i);
					if (!m)
						return 0;
					headerflags.push((m[1] ? 1 : 0) + (m[2] ? 2 : 0));
				}
	

				container.string_content = '';

			//if (!parser.indented && parser.nonSpace().includes('|')) {
				parser.closeUnmatchedBlocks();
				parser.addChild(new Table(container.sourcepos.start, headerflags));
				return 2;
			}
			return 0;
		}, 1);
	}

	constructor(pos: SourcePos, public headerflags: number[]) {
		super("table", pos);
	}

	continue(parser: BlockParser) {
		return parser.blank ? 1 : 0;
	}
	acceptsLines()	{ return true; }

	finalize() {
		const lines = this.string_content.split('\n');
	
		const head = new TableItem('thead');
		this.appendChild(head);

		const row = new TableItem('tr');
		head.appendChild(row);
		putrow(row, lines[0], 'th', this.headerflags);

		const body = new TableItem('tbody');
		this.appendChild(body);
		for (const i of lines.slice(2)) {
			const row = new TableItem('tr');
			body.appendChild(row);

			putrow(row, i, 'td', this.headerflags);
		}
		this.string_content = '';
	}
}