import { expect } from 'chai';
import { describe, it } from 'mocha';

import { dedent } from '../../__testUtils__/dedent';
import { expectJSON, expectToThrowJSON } from '../../__testUtils__/expectJSON';
import { kitchenSinkQuery } from '../../__testUtils__/kitchenSinkQuery';

import { inspect } from '../../jsutils/inspect';

import { Kind } from '../kinds';
import { parse, parseConstValue, parseType, parseValue } from '../parser';
import { Source } from '../source';
import { TokenKind } from '../tokenKind';

function expectSyntaxError(text: string) {
  return expectToThrowJSON(() => parse(text));
}

describe('Parser', () => {
  it('parse provides useful errors', () => {
    let caughtError;
    try {
      parse('{');
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).to.deep.contain({
      message: 'Syntax Error: Expected Name, found <EOF>.',
      positions: [1],
      locations: [{ line: 1, column: 2 }],
    });

    expect(String(caughtError)).to.equal(dedent`
      Syntax Error: Expected Name, found <EOF>.

      GraphQL request:1:2
      1 | {
        |  ^
    `);

    expectSyntaxError(`
      { ...MissingOn }
      fragment MissingOn Type
    `).to.deep.include({
      message: 'Syntax Error: Expected "on", found Name "Type".',
      locations: [{ line: 3, column: 26 }],
    });

    expectSyntaxError('{ field: {} }').to.deep.include({
      message: 'Syntax Error: Expected Name, found "{".',
      locations: [{ line: 1, column: 10 }],
    });

    expectSyntaxError('notAnOperation Foo { field }').to.deep.include({
      message: 'Syntax Error: Unexpected Name "notAnOperation".',
      locations: [{ line: 1, column: 1 }],
    });

    expectSyntaxError('...').to.deep.include({
      message: 'Syntax Error: Unexpected "...".',
      locations: [{ line: 1, column: 1 }],
    });

    expectSyntaxError('{ ""').to.deep.include({
      message: 'Syntax Error: Expected Name, found String "".',
      locations: [{ line: 1, column: 3 }],
    });
  });

  it('parse provides useful error when using source', () => {
    let caughtError;
    try {
      parse(new Source('query', 'MyQuery.graphql'));
    } catch (error) {
      caughtError = error;
    }
    expect(String(caughtError)).to.equal(dedent`
      Syntax Error: Expected "{", found <EOF>.

      MyQuery.graphql:1:6
      1 | query
        |      ^
    `);
  });

  it('exposes the tokenCount', () => {
    expect(parse('{ foo }').tokenCount).to.equal(3);
    expect(parse('{ foo(bar: "baz") }').tokenCount).to.equal(8);
  });

  it('limit maximum number of tokens', () => {
    expect(() => parse('{ foo }', { maxTokens: 3 })).to.not.throw();
    expect(() => parse('{ foo }', { maxTokens: 2 })).to.throw(
      'Syntax Error: Document contains more that 2 tokens. Parsing aborted.',
    );

    expect(() => parse('{ foo(bar: "baz") }', { maxTokens: 8 })).to.not.throw();

    expect(() => parse('{ foo(bar: "baz") }', { maxTokens: 7 })).to.throw(
      'Syntax Error: Document contains more that 7 tokens. Parsing aborted.',
    );
  });

  it('parses variable inline values', () => {
    expect(() =>
      parse('{ field(complex: { a: { b: [ $var ] } }) }'),
    ).to.not.throw();
  });

  it('parses constant default values', () => {
    expectSyntaxError(
      'query Foo($x: Complex = { a: { b: [ $var ] } }) { field }',
    ).to.deep.equal({
      message: 'Syntax Error: Unexpected variable "$var" in constant value.',
      locations: [{ line: 1, column: 37 }],
    });
  });

  it('parses variable definition directives', () => {
    expect(() =>
      parse('query Foo($x: Boolean = false @bar) { field }'),
    ).to.not.throw();
  });

  it('does not accept fragments named "on"', () => {
    expectSyntaxError('fragment on on on { on }').to.deep.equal({
      message: 'Syntax Error: Unexpected Name "on".',
      locations: [{ line: 1, column: 10 }],
    });
  });

  it('does not accept fragments spread of "on"', () => {
    expectSyntaxError('{ ...on }').to.deep.equal({
      message: 'Syntax Error: Expected Name, found "}".',
      locations: [{ line: 1, column: 9 }],
    });
  });

  it('does not allow "true", "false", or "null" as enum value', () => {
    expectSyntaxError('enum Test { VALID, true }').to.deep.equal({
      message:
        'Syntax Error: Name "true" is reserved and cannot be used for an enum value.',
      locations: [{ line: 1, column: 20 }],
    });

    expectSyntaxError('enum Test { VALID, false }').to.deep.equal({
      message:
        'Syntax Error: Name "false" is reserved and cannot be used for an enum value.',
      locations: [{ line: 1, column: 20 }],
    });

    expectSyntaxError('enum Test { VALID, null }').to.deep.equal({
      message:
        'Syntax Error: Name "null" is reserved and cannot be used for an enum value.',
      locations: [{ line: 1, column: 20 }],
    });
  });

  it('parses multi-byte characters', () => {
    // Note: \u0A0A could be naively interpreted as two line-feed chars.
    const ast = parse(`
      # This comment has a \u0A0A multi-byte character.
      { field(arg: "Has a \u0A0A multi-byte character.") }
    `);

    expect(ast).to.have.nested.property(
      'definitions[0].selectionSet.selections[0].arguments[0].value.value',
      'Has a \u0A0A multi-byte character.',
    );
  });

  it('parses kitchen sink', () => {
    expect(() => parse(kitchenSinkQuery)).to.not.throw();
  });

  it('allows non-keywords anywhere a Name is allowed', () => {
    const nonKeywords = [
      'on',
      'fragment',
      'query',
      'mutation',
      'subscription',
      'true',
      'false',
    ];
    for (const keyword of nonKeywords) {
      // You can't define or reference a fragment named `on`.
      const fragmentName = keyword !== 'on' ? keyword : 'a';
      const document = `
        query ${keyword} {
          ... ${fragmentName}
          ... on ${keyword} { field }
        }
        fragment ${fragmentName} on Type {
          ${keyword}(${keyword}: $${keyword})
            @${keyword}(${keyword}: ${keyword})
        }
      `;

      expect(() => parse(document)).to.not.throw();
    }
  });

  it('parses anonymous mutation operations', () => {
    expect(() =>
      parse(`
      mutation {
        mutationField
      }
    `),
    ).to.not.throw();
  });

  it('parses anonymous subscription operations', () => {
    expect(() =>
      parse(`
      subscription {
        subscriptionField
      }
    `),
    ).to.not.throw();
  });

  it('parses named mutation operations', () => {
    expect(() =>
      parse(`
      mutation Foo {
        mutationField
      }
    `),
    ).to.not.throw();
  });

  it('parses named subscription operations', () => {
    expect(() =>
      parse(`
      subscription Foo {
        subscriptionField
      }
    `),
    ).to.not.throw();
  });

  it('creates ast', () => {
    const result = parse(dedent`
      {
        node(id: 4) {
          id,
          name
        }
      }
    `);

    expectJSON(result).toDeepEqual({
      kind: Kind.DOCUMENT,
      loc: { start: 0, end: 40 },
      definitions: [
        {
          kind: Kind.OPERATION_DEFINITION,
          description: undefined,
          loc: { start: 0, end: 40 },
          operation: 'query',
          name: undefined,
          variableDefinitions: [],
          directives: [],
          selectionSet: {
            kind: Kind.SELECTION_SET,
            loc: { start: 0, end: 40 },
            selections: [
              {
                kind: Kind.FIELD,
                loc: { start: 4, end: 38 },
                alias: undefined,
                name: {
                  kind: Kind.NAME,
                  loc: { start: 4, end: 8 },
                  value: 'node',
                },
                arguments: [
                  {
                    kind: Kind.ARGUMENT,
                    name: {
                      kind: Kind.NAME,
                      loc: { start: 9, end: 11 },
                      value: 'id',
                    },
                    value: {
                      kind: Kind.INT,
                      loc: { start: 13, end: 14 },
                      value: '4',
                    },
                    loc: { start: 9, end: 14 },
                  },
                ],
                directives: [],
                selectionSet: {
                  kind: Kind.SELECTION_SET,
                  loc: { start: 16, end: 38 },
                  selections: [
                    {
                      kind: Kind.FIELD,
                      loc: { start: 22, end: 24 },
                      alias: undefined,
                      name: {
                        kind: Kind.NAME,
                        loc: { start: 22, end: 24 },
                        value: 'id',
                      },
                      arguments: [],
                      directives: [],
                      selectionSet: undefined,
                    },
                    {
                      kind: Kind.FIELD,
                      loc: { start: 30, end: 34 },
                      alias: undefined,
                      name: {
                        kind: Kind.NAME,
                        loc: { start: 30, end: 34 },
                        value: 'name',
                      },
                      arguments: [],
                      directives: [],
                      selectionSet: undefined,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    });
  });

  it('creates ast from nameless query without variables', () => {
    const result = parse(dedent`
      query {
        node {
          id
        }
      }
    `);

    expectJSON(result).toDeepEqual({
      kind: Kind.DOCUMENT,
      loc: { start: 0, end: 29 },
      definitions: [
        {
          kind: Kind.OPERATION_DEFINITION,
          loc: { start: 0, end: 29 },
          description: undefined,
          operation: 'query',
          name: undefined,
          variableDefinitions: [],
          directives: [],
          selectionSet: {
            kind: Kind.SELECTION_SET,
            loc: { start: 6, end: 29 },
            selections: [
              {
                kind: Kind.FIELD,
                loc: { start: 10, end: 27 },
                alias: undefined,
                name: {
                  kind: Kind.NAME,
                  loc: { start: 10, end: 14 },
                  value: 'node',
                },
                arguments: [],
                directives: [],
                selectionSet: {
                  kind: Kind.SELECTION_SET,
                  loc: { start: 15, end: 27 },
                  selections: [
                    {
                      kind: Kind.FIELD,
                      loc: { start: 21, end: 23 },
                      alias: undefined,
                      name: {
                        kind: Kind.NAME,
                        loc: { start: 21, end: 23 },
                        value: 'id',
                      },
                      arguments: [],
                      directives: [],
                      selectionSet: undefined,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    });
  });

  it('creates ast from nameless query with description', () => {
    const result = parse(dedent`
      "Description"
      query {
        node {
          id
        }
      }
    `);

    expectJSON(result).toDeepEqual({
      kind: Kind.DOCUMENT,
      loc: { start: 0, end: 43},
      definitions: [
        {
          kind: Kind.OPERATION_DEFINITION,
          loc: { start: 0, end: 43 },
          description: {
            kind: Kind.STRING,
            loc: { start: 0, end: 13 },
            value: 'Description',
            block: false,
          },
          operation: 'query',
          name: undefined,
          variableDefinitions: [],
          directives: [],
          selectionSet: {
            kind: Kind.SELECTION_SET,
            loc: { start: 20, end: 43 },
            selections: [
              {
                kind: Kind.FIELD,
                loc: { start: 24, end: 41 },
                alias: undefined,
                name: {
                  kind: Kind.NAME,
                  loc: { start: 24, end: 28 },
                  value: 'node',
                },
                arguments: [],
                directives: [],
                selectionSet: {
                  kind: Kind.SELECTION_SET,
                  loc: { start: 29, end: 41 },
                  selections: [
                    {
                      kind: Kind.FIELD,
                      loc: { start: 35, end: 37 },
                      alias: undefined,
                      name: {
                        kind: Kind.NAME,
                        loc: { start: 35, end: 37 },
                        value: 'id',
                      },
                      arguments: [],
                      directives: [],
                      selectionSet: undefined,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    });
  });

  it('allows parsing without source location information', () => {
    const result = parse('{ id }', { noLocation: true });
    expect('loc' in result).to.equal(false);
  });

  it('Legacy: allows parsing fragment defined variables', () => {
    const document = 'fragment a($v: Boolean = false) on t { f(v: $v) }';

    expect(() =>
      parse(document, { allowLegacyFragmentVariables: true }),
    ).to.not.throw();
    expect(() => parse(document)).to.throw('Syntax Error');
  });

  it('contains location that can be Object.toStringified, JSON.stringified, or jsutils.inspected', () => {
    const { loc } = parse('{ id }');

    expect(Object.prototype.toString.call(loc)).to.equal('[object Location]');
    expect(JSON.stringify(loc)).to.equal('{"start":0,"end":6}');
    expect(inspect(loc)).to.equal('{ start: 0, end: 6 }');
  });

  it('contains references to source', () => {
    const source = new Source('{ id }');
    const result = parse(source);

    expect(result).to.have.nested.property('loc.source', source);
  });

  it('contains references to start and end tokens', () => {
    const result = parse('{ id }');

    expect(result).to.have.nested.property(
      'loc.startToken.kind',
      TokenKind.SOF,
    );
    expect(result).to.have.nested.property('loc.endToken.kind', TokenKind.EOF);
  });

  describe('parseValue', () => {
    it('parses null value', () => {
      const result = parseValue('null');
      expectJSON(result).toDeepEqual({
        kind: Kind.NULL,
        loc: { start: 0, end: 4 },
      });
    });

    it('parses list values', () => {
      const result = parseValue('[123 "abc"]');
      expectJSON(result).toDeepEqual({
        kind: Kind.LIST,
        loc: { start: 0, end: 11 },
        values: [
          {
            kind: Kind.INT,
            loc: { start: 1, end: 4 },
            value: '123',
          },
          {
            kind: Kind.STRING,
            loc: { start: 5, end: 10 },
            value: 'abc',
            block: false,
          },
        ],
      });
    });

    it('parses block strings', () => {
      const result = parseValue('["""long""" "short"]');
      expectJSON(result).toDeepEqual({
        kind: Kind.LIST,
        loc: { start: 0, end: 20 },
        values: [
          {
            kind: Kind.STRING,
            loc: { start: 1, end: 11 },
            value: 'long',
            block: true,
          },
          {
            kind: Kind.STRING,
            loc: { start: 12, end: 19 },
            value: 'short',
            block: false,
          },
        ],
      });
    });

    it('allows variables', () => {
      const result = parseValue('{ field: $var }');
      expectJSON(result).toDeepEqual({
        kind: Kind.OBJECT,
        loc: { start: 0, end: 15 },
        fields: [
          {
            kind: Kind.OBJECT_FIELD,
            loc: { start: 2, end: 13 },
            name: {
              kind: Kind.NAME,
              loc: { start: 2, end: 7 },
              value: 'field',
            },
            value: {
              kind: Kind.VARIABLE,
              loc: { start: 9, end: 13 },
              name: {
                kind: Kind.NAME,
                loc: { start: 10, end: 13 },
                value: 'var',
              },
            },
          },
        ],
      });
    });

    it('correct message for incomplete variable', () => {
      expect(() => parseValue('$'))
        .to.throw()
        .to.deep.include({
          message: 'Syntax Error: Expected Name, found <EOF>.',
          locations: [{ line: 1, column: 2 }],
        });
    });

    it('correct message for unexpected token', () => {
      expect(() => parseValue(':'))
        .to.throw()
        .to.deep.include({
          message: 'Syntax Error: Unexpected ":".',
          locations: [{ line: 1, column: 1 }],
        });
    });
  });

  describe('parseConstValue', () => {
    it('parses values', () => {
      const result = parseConstValue('[123 "abc"]');
      expectJSON(result).toDeepEqual({
        kind: Kind.LIST,
        loc: { start: 0, end: 11 },
        values: [
          {
            kind: Kind.INT,
            loc: { start: 1, end: 4 },
            value: '123',
          },
          {
            kind: Kind.STRING,
            loc: { start: 5, end: 10 },
            value: 'abc',
            block: false,
          },
        ],
      });
    });

    it('does not allow variables', () => {
      expect(() => parseConstValue('{ field: $var }'))
        .to.throw()
        .to.deep.include({
          message:
            'Syntax Error: Unexpected variable "$var" in constant value.',
          locations: [{ line: 1, column: 10 }],
        });
    });

    it('correct message for unexpected token', () => {
      expect(() => parseConstValue('$'))
        .to.throw()
        .to.deep.include({
          message: 'Syntax Error: Unexpected "$".',
          locations: [{ line: 1, column: 1 }],
        });
    });
  });

  describe('parseType', () => {
    it('parses well known types', () => {
      const result = parseType('String');
      expectJSON(result).toDeepEqual({
        kind: Kind.NAMED_TYPE,
        loc: { start: 0, end: 6 },
        name: {
          kind: Kind.NAME,
          loc: { start: 0, end: 6 },
          value: 'String',
        },
      });
    });

    it('parses custom types', () => {
      const result = parseType('MyType');
      expectJSON(result).toDeepEqual({
        kind: Kind.NAMED_TYPE,
        loc: { start: 0, end: 6 },
        name: {
          kind: Kind.NAME,
          loc: { start: 0, end: 6 },
          value: 'MyType',
        },
      });
    });

    it('parses list types', () => {
      const result = parseType('[MyType]');
      expectJSON(result).toDeepEqual({
        kind: Kind.LIST_TYPE,
        loc: { start: 0, end: 8 },
        type: {
          kind: Kind.NAMED_TYPE,
          loc: { start: 1, end: 7 },
          name: {
            kind: Kind.NAME,
            loc: { start: 1, end: 7 },
            value: 'MyType',
          },
        },
      });
    });

    it('parses non-null types', () => {
      const result = parseType('MyType!');
      expectJSON(result).toDeepEqual({
        kind: Kind.NON_NULL_TYPE,
        loc: { start: 0, end: 7 },
        type: {
          kind: Kind.NAMED_TYPE,
          loc: { start: 0, end: 6 },
          name: {
            kind: Kind.NAME,
            loc: { start: 0, end: 6 },
            value: 'MyType',
          },
        },
      });
    });

    it('parses nested types', () => {
      const result = parseType('[MyType!]');
      expectJSON(result).toDeepEqual({
        kind: Kind.LIST_TYPE,
        loc: { start: 0, end: 9 },
        type: {
          kind: Kind.NON_NULL_TYPE,
          loc: { start: 1, end: 8 },
          type: {
            kind: Kind.NAMED_TYPE,
            loc: { start: 1, end: 7 },
            name: {
              kind: Kind.NAME,
              loc: { start: 1, end: 7 },
              value: 'MyType',
            },
          },
        },
      });
    });
  });

    describe('operation and variable definition descriptions', () => {
    it('parses operation with description and variable descriptions', () => {
      const result = parse(dedent`
        "Operation description"
        query myQuery(
          "Variable a description"
          $a: Int,
          """Variable b\nmultiline description"""
          $b: String
        ) {
          field(a: $a, b: $b)
        }
      `);
      // Find the operation definition
      const opDef = result.definitions.find(
        (d) => d.kind === Kind.OPERATION_DEFINITION,
      );
      if (!opDef || opDef.kind !== Kind.OPERATION_DEFINITION) {
        throw new Error('No operation definition found');
      }
      expect(opDef.description?.value).to.equal('Operation description');
      expect(opDef.name?.value).to.equal('myQuery');
      expect(opDef.variableDefinitions?.[0].description?.value).to.equal(
        'Variable a description',
      );
      expect(opDef.variableDefinitions?.[0].description?.block).to.equal(false);
      expect(opDef.variableDefinitions?.[1].description?.value).to.equal(
        'Variable b\nmultiline description',
      );
      expect(opDef.variableDefinitions?.[1].description?.block).to.equal(true);
      expect(opDef.variableDefinitions?.[0].variable.name.value).to.equal('a');
      expect(opDef.variableDefinitions?.[1].variable.name.value).to.equal('b');
      // Check type names safely
      const typeA = opDef.variableDefinitions?.[0].type;
      if (typeA && typeA.kind === Kind.NAMED_TYPE) {
        expect(typeA.name.value).to.equal('Int');
      }
      const typeB = opDef.variableDefinitions?.[1].type;
      if (typeB && typeB.kind === Kind.NAMED_TYPE) {
        expect(typeB.name.value).to.equal('String');
      }
    });

    it('parses variable definition with description, default value, and directives', () => {
      const result = parse(dedent`
        query (
          "desc"
          $foo: Int = 42 @dir
        ) {
          field(foo: $foo)
        }
      `);
      const opDef = result.definitions.find(
        (d) => d.kind === Kind.OPERATION_DEFINITION,
      );
      if (!opDef || opDef.kind !== Kind.OPERATION_DEFINITION) {
        throw new Error('No operation definition found');
      }
      const varDef = opDef.variableDefinitions?.[0];
      expect(varDef?.description?.value).to.equal('desc');
      expect(varDef?.variable.name.value).to.equal('foo');
      if (varDef?.type.kind === Kind.NAMED_TYPE) {
        expect(varDef.type.name.value).to.equal('Int');
      }
      if (varDef?.defaultValue && 'value' in varDef.defaultValue) {
        expect(varDef.defaultValue.value).to.equal('42');
      }
      expect(varDef?.directives?.[0].name.value).to.equal('dir');
    });

    it('parses fragment with variable description (legacy)', () => {
      const result = parse('fragment Foo("desc" $foo: Int) on Bar { baz }', {
        allowLegacyFragmentVariables: true,
      });
      const fragDef = result.definitions.find(
        (d) => d.kind === Kind.FRAGMENT_DEFINITION,
      );
      if (!fragDef || fragDef.kind !== Kind.FRAGMENT_DEFINITION) {
        throw new Error('No fragment definition found');
      }
      const varDef = fragDef.variableDefinitions?.[0];
      expect(varDef?.description?.value).to.equal('desc');
      expect(varDef?.variable.name.value).to.equal('foo');
      if (varDef?.type.kind === Kind.NAMED_TYPE) {
        expect(varDef.type.name.value).to.equal('Int');
      }
    });
  });
});
