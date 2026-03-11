import {StringParser} from "./utils"
import * as xml from "@isopodlabs/xml";

type Node1 = string | xml.Element;
type Node = string | xml.Element | undefined;

function calcRows(i?: xml.Node) : number {
	if (i === undefined)
		return 0;

	if (xml.isElement(i)) {
		if (i.name === 'frac')
			return calcRows(i.children[0]) + calcRows(i.children[1]);
		return i.children.reduce((prev, i) => Math.max(prev, calcRows(i)), 1);
	}
	return 1;
}

function fix(children: Node[]) {
	return children.reduce((nodes, i) => {
		if (i) {
			if (typeof(i) !== 'string' || typeof(nodes.at(-1)) !== 'string')
				return [...nodes, i];
			nodes[nodes.length - 1] += i;
		}
		return nodes;
	}, [] as Node1[]);
}

function make(name: string, ...children: Node[]) {
	return new xml.Element(name, {}, fix(children));
}

function make_sized(name: string, ...children: Node[]) {
	const children2 = fix(children);
	const rows = children2.reduce((prev, i) => Math.max(prev, calcRows(i)), 1);
	return new xml.Element(name, {rows}, children2);
}

function combine(children?: Node[]) {
	if (children) {
		const children2 = fix(children);
		return children2.length === 1 ? children2[0] : new xml.Element('span', {}, children2);
	}
}

function add_diacritic(diacritic: string, node: Node) {
	if (typeof node === 'string' && node.length === 1)
		return node + diacritic.at(-1);
}

function identifier(name: string) {
	return make('identifier', name);
}
function func(name: string) {
	return make('func', name);
}


function group(p: StringParser) {
	if (p.skip('{')) {
		const exp = subexpr(p);
		if (!p.skip('}'))
			throw new Error("Expected '}'");
		return exp;
	}
}

function char(p: StringParser): string {
	if (p.skip('{')) {
		const exp = subexpr(p);
		if (!p.skip('}'))
			throw new Error("Expected '}'");
		if (typeof(exp) === 'string')
			return exp;
		const exp2 = fix(exp);
		if (exp2.length === 1 && typeof(exp2[0]) === 'string')
			return exp2[0];
		throw new Error("syntax");
	}
	if (p.skip('\\')) {
		const name = p.match(/^([a-zA-Z]+|.)/)
		if (name && macros[name]) {
			const exp = macros[name](p);
			if (typeof(exp) === 'string')
				return exp;
		}
		throw new Error("syntax");
	}
	return p.get(1);
}

function primes(primes?: string) {
	if (primes && primes.length <= 4)
		return "′″‴⁗"[primes.length - 1];
	return primes;
}

function leaf(p: StringParser): Node {
	if (p.skip('\\')) {
		const name = p.match(/^([a-zA-Z]+|.)/)
		if (name && macros[name])
			return macros[name](p);
		throw new Error("syntax");
	}
	if (p.skip('^'))
		return make('sup', char(p));

	if (p.skip('_'))
		return make('sub', char(p));

	const alpha = p.match(/^[a-zA-Z]+/);
	if (alpha)
		return identifier(alpha);
	return primes(p.match(/^'+/)) ?? p.match(/^[^{}_^'\\|a-zA-Z]+/);
}

function term(p: StringParser): Node[] | undefined {
	let arg1 = leaf(p);
	if (arg1) {
		const nodes: Node[] = [arg1];
		let arg2;
		while (arg2 = leaf(p))
			nodes.push(arg2);
		return nodes;
	}
}

function subexpr(p: StringParser) : Node[] {
	const nodes: Node[] = [];

	for (;;) {
		if (p.skip('|')) {
			const exp = term(p);
			if (!exp)
				break;
			p.expect('|');
			nodes.push(make('abs', ...exp));
			continue;
		}
		const exp = term(p);
		if (!exp)
			break;
		nodes.push(...exp);
	}
	return nodes;
}

export function expression(p: StringParser) : Node {
	return make('maths', ...subexpr(p));
}

function make_big(text: string, p: StringParser) {
	const nodes: Node[] = [text];

	if (p.skip('^'))
		nodes.push(make('sup', char(p)));
	if (p.skip('_'))
		nodes.push(make('sub', char(p)));

	nodes.push(...subexpr(p));
	return make('big', ...nodes);
}

const macros: Record<string, (p: StringParser)=> Node> = {

	text:				p=> p.match(/^{.*?}/)?.slice(1, -1) ,

	frac:				p => make('frac', combine(group(p)), combine(group(p))),
	sqrt:				p => make_sized('sqrt', combine(group(p))),

	sum:				p => make_big('∑', p),
	prod:				p => make_big('∏', p),
	coprod:				p => make_big('∐', p),
	bigoplus:			p => make_big('⨁', p),
	bigotimes:			p => make_big('⨂', p),
	bigodot:			p => make_big('⨀', p),
	bigcup:				p => make_big('⋃', p),
	bigcap:				p => make_big('⋂', p),
	biguplus:			p => make_big('⨄', p),
	bigsqcup:			p => make_big('⨆', p),
	bigvee:				p => make_big('⋁', p),
	bigwedge:			p => make_big('⋀', p),
	int:				p => make_big('∫', p),
	oint:				p => make_big('∮', p),
	iint:				p => make_big('∬', p),
	iiint:				p => make_big('∭', p),
	iiiint:				p => make_big('⨌', p),
	idotsint:			p => make_big('∫⋯∫', p),

	pmod:				p => make('pmod', ...group(p)!),
	bmod:				p => make('bmod', ...group(p)!),
	binom:				p => make('binom', combine(group(p)), combine(group(p))),
	boxed:				p=> (make('boxed', ...group(p)!)),

	//diacritics		
	not:				p => add_diacritic('◌̸', char(p)),
	acute:				p => add_diacritic('◌́', char(p)),
	hat:				p => add_diacritic('◌̂', char(p)),
	tilde:				p => add_diacritic('◌̃', char(p)),
	bar:				p => add_diacritic('◌̄', char(p)),
	overline:			p => add_diacritic('◌̅', char(p)),
	breve:				p => add_diacritic('◌̆', char(p)),
	dot:				p => add_diacritic('◌̇', char(p)),
	ddot:				p => add_diacritic('◌̈', char(p)),
	vec:				p => add_diacritic('\u20d7', char(p)),//◌⃗
	'`':				p => add_diacritic('◌̀', char(p)),	// grave accent
	"'":				p => add_diacritic('◌́', char(p)),	// acute accent
	'^':				p => add_diacritic('◌̂', char(p)),	// circumflex
	'"':				p => add_diacritic('◌̈', char(p)),	// umlaut, trema or dieresis
	'H':				p => add_diacritic('◌̋', char(p)),	// long Hungarian umlaut (double acute)
	'~':				p => add_diacritic('◌̃', char(p)),	// tilde
	'=':				p => add_diacritic('◌̄', char(p)),	// macron accent (a bar over the letter)
	'b':				p => add_diacritic('◌̲', char(p)),	// bar under the letter
	'.':				p => add_diacritic('◌̇', char(p)),	// dot over the letter
	'd':				p => add_diacritic('◌̣', char(p)),	// dot under the letter
	'r':				p => add_diacritic('◌̊', char(p)),	// ring over the letter (for å there is also the special command \aa)
	'u':				p => add_diacritic('◌̆', char(p)),	// breve over the letter
	'v':				p => add_diacritic('◌̌', char(p)),	// caron/háček ("v") over the letter
	't':				p => add_diacritic('◌͡◌', char(p)),// "tie" (inverted u) over the two letters
	check:				p => add_diacritic('◌̌', char(p)),	// vee or check
	widehat:			p => add_diacritic('◌᷍◌', char(p)),// wide version of \hat over several letters	
	widetilde:			p => add_diacritic('◌͠◌', char(p)),// wide version of \tilde over several letters	

	underline:			p => make('underline', char(p)),

	//a' or a^{\prime}		a	′
	//a''			a	″
	//a'''		a	‴	 	a''''		a	⁗	 
	//a''''		a	‴	 	a''''		a	⁗	 
	//overleftarrow:		
	//overrightarrow:		
//	\dddot{a}[note 1]
//	\ddddot{a}[note 1]	
//	\stackrel\frown{AAA}		A	A	A	⌢	 

	'c':				p => 'ç',
	'k':				p => 'ą',	// ogonek
	'l':				p => 'ł',	// barred l (l with stroke)
	'o':				p => 'ø',	// slashed o (o with stroke)
	'i':				p => 'ı',	// dotless i (i without tittle)
	'%':				p => '%',
	'$':				p => '$',
	'{':				p => '{',
	'_':				p => '_',
	'P':				p => '¶',
	'#':				p => '#',
	'&':				p => '&',
	'}':				p => '}',
	'S':				p => '§',

	parallel:			p => '∥',
	nparallel:			p => '∦',
	doteq:				p => '≐',
	asymp:				p => '≍',
	bowtie:				p => '⋈',
	ll:					p => '≪',
	gg:					p => '≫',
	equiv:				p => '≡',
	vdash:				p => '⊢',
	dashv:				p => '⊣',
	subset:				p => '⊂',
	supset:				p => '⊃',
	approx:				p => '≈',
	in:					p => '∈',
	ni:					p => '∋',
	subseteq:			p => '⊆',
	supseteq:			p => '⊇',
	cong:				p => '≅',
	smile:				p => '⌣',
	frown:				p => '⌢',
	nsubseteq:			p => '⊈',
	nsupseteq:			p => '⊉',
	simeq:				p => '≃',
	models:				p => '⊨',
	notin:				p => '∉',
	sqsubset:			p => '⊏',
	sqsupset:			p => '⊐',
	sim:				p => '∼',
	perp:				p => '⊥',
	mid:				p => '∣',
	sqsubseteq:			p => '⊑',
	sqsupseteq:			p => '⊒',
	propto:				p => '∝',
	prec:				p => '≺',
	succ:				p => '≻',
	preceq:				p => '⪯',
	succeq:				p => '⪰',
	sphericalangle:		p => '∢',
	measuredangle:		p => '∡',
	therefore:			p => '∴',
	because:			p => '∵',
	ddag:				p => '‡',
	textbar:			p => '|',
	textless:			p => '<',
	textgreater:		p => '>',
	textasciitilde:		p => '~',
	textvisiblespace:	p => ' ',
	textendash:			p => '–',
	texttrademark:		p => '™',
	textexclamdown:		p => '¡',
	pounds:				p => '£',
	dag:				p => '†',
	textbackslash:		p => '\\',
	textemdash:			p => '—',
	textregistered:		p => '®',
	textquestiondown:	p => '¿',
	copyright:			p => '©',

//macros.textsuperscript	= p => '{a}	Xa	a
//macros.textcircled		= p => '{a}	n/a	ⓐ

//Binary Operations
	cap:				p => '∩',
	diamond:			p => '⋄',
	oplus:				p => '⊕',
	cup:				p => '∪',
	bigtriangleup:		p => '△',
	ominus:				p => '⊖',
	times:				p => '×',
	uplus:				p => '⊎',
	bigtriangledown:	p => '▽',
	otimes:				p => '⊗',
	div:				p => '÷',
	sqcap:				p => '⊓',
	triangleleft:		p => '◃',
	oslash:				p => '⊘',
	ast:				p => '∗',
	sqcup:				p => '⊔',
	triangleright:		p => '▹',
	odot:				p => '⊙',
	star:				p => '⋆',
	vee:				p => '∨',
	bigcirc:			p => '◯',
	circ:				p => '∘',
	dagger:				p => '†',
	wedge:				p => '∧',
	bullet:				p => '∙',
	setminus:			p => '∖',
	ddagger:			p => '‡',
	cdot:				p => '⋅',
	wr:					p => '≀',
	amalg:				p => '⨿',

//Delimiters
	'|':				p => '‖',
	backslash:			p => '∖',
	langle:				p => '⟨',
	rangle:				p => '⟩',
	uparrow:			p => '↑',
	Uparrow:			p => '⇑',
	lceil:				p => '⌈',
	rceil:				p => '⌉',
	downarrow:			p => '↓',
	Downarrow:			p => '⇓',
	lfloor:				p => '⌊',
	rfloor:				p => '⌋',

//Greek
	alpha:				p => identifier('α'),	//U+03B1
	beta:				p => identifier('β'),	//U+03B2
	gamma:				p => identifier('γ'),	//U+03B3
	delta:				p => identifier('δ'),	//U+03B4
	epsilon:			p => identifier('ε'),	//U+03B5
	zeta:				p => identifier('ζ'),	//U+03B6
	eta:				p => identifier('η'),	//U+03B7
	theta:				p => identifier('θ'),	//U+03B8
	iota:				p => identifier('ι'),	//U+03B9
	kappa:				p => identifier('κ'),	//U+03BA
	lamda:				p => identifier('λ'),	//U+03BB
	mu:					p => identifier('μ'),	//U+03BC
	nu:					p => identifier('ν'),	//U+03BD
	xi:					p => identifier('ξ'),	//U+03BE
	omicron:			p => identifier('ο'),	//U+03BF
	pi:					p => identifier('π'),	//U+03C0
	rho:				p => identifier('ρ'),	//U+03C1
	sigma:				p => identifier('σ'),	//U+03C3
	tau:				p => identifier('τ'),	//U+03C4
	upsilon:			p => identifier('υ'),	//U+03C5
	phi:				p => identifier('φ'),	//U+03C6
	chi:				p => identifier('χ'),	//U+03C7
	psi:				p => identifier('ψ'),	//U+03C8
	omega:				p => identifier('ω'),	//U+03C9

	//Alpha:			p => identifier('Α'),	//U+0391
	//Beta:				p => identifier('Β'),	//U+0392
	Gamma:				p => identifier('Γ'),	//U+0393
	Delta:				p => identifier('Δ'),	//U+0394
	//Epsilon:			p => identifier('Ε'),	//U+0395
	//Zeta:				p => identifier('Ζ'),	//U+0396
	//Eta:				p => identifier('Η'),	//U+0397
	Theta:				p => identifier('Θ'),	//U+0398
	//Iota:				p => identifier('Ι'),	//U+0399
	//Kappa:			p => identifier('Κ'),	//U+039A
	Lamda:				p => identifier('Λ'),	//U+039B
	//Mu:				p => identifier('Μ'),	//U+039C
	//Nu:				p => identifier('Ν'),	//U+039D
	//Xi:				p => identifier('Ξ'),	//U+039E
	//Omicron:			p => identifier('Ο'),	//U+039F
	//Pi:				p => identifier('Π'),	//U+03A0
	//Rho:				p => identifier('Ρ'),	//U+03A1
	//Sigma:			p => identifier('Σ'),	//U+03A3
	//Tau:				p => identifier('Τ'),	//U+03A4
	Upsilon:			p => identifier('Υ'),	//U+03A5
	Phi:				p => identifier('Φ'),	//U+03A6
	//Chi:				p => identifier('Χ'),	//U+03A7
	Psi:				p => identifier('Ψ'),	//U+03A8
	Omega:				p => identifier('Ω'),	//U+03A9
	
	varpi:				p => 'ϖ',
	varepsilon:			p => 'ε',
	varrho:				p => 'ϱ',
	varsigma:			p => 'ς',
	vartheta:			p => 'ϑ',
	varphi:				p => 'φ',
	varkappa:			p => 'ϰ',

//Math Symbols
	pm:					p => '±',
	mp:					p => '±',
	forall:				p => '∀',
	exists:				p => '∃',
	neq:				p => '≠',
	geq:				p => '≥',
	leq:				p => '≤',
	drawnr:				p => '□',
	Z:					p => 'ℤ',
	R:					p => 'ℝ',
	nexists:			p => '∄',
	rightarrow:			p => '→',
	Rightarrow:			p => '⇒',
	leftarrow:			p => '←',
	leftrightarrow:		p => '↔',
	Leftrightarrow:		p => '⇔',
	mapsto:				p => '↦',
	neg:				p => '¬',
	implies:			p => '⟹',
	impliedby:			p => '⟸',
	iff:				p => '⟺',
	land:				p => '∧',
	top:				p => '⊤',
	lor:				p => '∨',
	bot:				p => '⊥',
	angle:				p => '∠',
	emptyset:			p => '∅',
	rightleftharpoons:	p => '⇌',

	infty:				p => '∞',
	calP:				p => '℘',
	ell:				p => 'ℓ',
	partial:			p => '∂',
	imath:				p => 'ı',
	Re:					p => 'ℜ',
	nabla:				p => '∇',
	aleph:				p => 'ℵ',
	eth:				p => 'ð',
	jmath:				p => 'ȷ',
	Im:					p => 'ℑ',
	Box:				p => '◻',
	beth:				p => 'ℶ',
	hbar:				p => 'ℏ',
	wp:					p => '℘',
	gimel:				p => 'ℷ',

	zo:					p => '{0, 1}' ,

//	Exp:	p => 'Exp' ,
//	P:	p => 'P' ,
//	NP:	p => 'NP' ,
//	Pr:	p => 'Pr' ,
//	Enc:	p => 'Enc' ,
//	Dec:	p => 'Dec' ,
//	poly:	p => 'poly' ,

//Trigonometric Functions
	sin:				p => func('sin'),
	arcsin:				p => func('arcsin'),
	sinh:				p => func('sinh'),
	sec:				p => func('sec'),
	cos:				p => func('cos'),
	arccos:				p => func('arccos'),
	cosh:				p => func('cosh'),
	csc:				p => func('csc'),
	tan:				p => func('tan'),
	arctan:				p => func('arctan'),
	tanh:				p => func('tanh'),
	cot:				p => func('cot'),
	arccot:				p => func('arccot'),
	coth:				p => func('coth'),

};

macros.to 			= macros.rightarrow;
macros.gets			= macros.leftarrow;
macros.implies		= macros.Rightarrow;
macros.varnothing	= macros.emptyset;
macros["a'"]		= macros["'"];
macros["a`"]		= macros["`"];
macros["a="]		= macros["="];
macros.mathring		= macros.r;

function matrix_row(p: StringParser) {
	const row: Node[] = [combine(subexpr(p))];
	while (p.skip('&'))
		row.push(combine(subexpr(p)));
	return row;
}

macros.begin =	p => {
	if (p.skip('{matrix}')) {
		const node = make('matrix')
		while (!p.match(/end{matrix}/)) {
			node.children.push(make('row', ...matrix_row(p)));
		}
		return node;
	}
};

macros.left		= p=> {
	const left = char(p);
	const nodes: Node[] = [];
	while (!p.skip('\\right')) {
		const exp = term(p);
		if (!exp)
			break;
		nodes.push(...exp);
	}

	return make('span', left, ...nodes, char(p));
}

macros.newcommand = p => {
    const commandName = p.match(/\\[a-zA-Z]+/);
    const definition = group(p);
    if (commandName)
        macros[commandName.slice(1)] = () => combine(definition);
    throw new Error("Expected a command name after \\newcommand");
};

macros.renewcommand = p => {
    const commandName = p.match(/\\[a-zA-Z]+/);
    const definition = group(p);
    if (commandName)
        macros[commandName.slice(1)] = () => combine(definition);
    throw new Error("Expected a command name after \\renewcommand");
};

macros.DeclareMathOperator = p => {
    const commandName = p.match(/\\[a-zA-Z]+/);
    const definition = group(p);
    if (commandName)
        macros[commandName.slice(1)] = () => make('func', ...definition!);
	return undefined;
};
