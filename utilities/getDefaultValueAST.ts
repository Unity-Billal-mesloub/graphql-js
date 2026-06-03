import { invariant } from '../jsutils/invariant.ts';
import type { ConstValueNode } from '../language/ast.ts';
import type { GraphQLArgument, GraphQLInputField } from '../type/definition.ts';
// eslint-disable-next-line import/no-deprecated
import { astFromValue } from './astFromValue.ts';
import { valueToLiteral } from './valueToLiteral.ts';
/** @internal */
export function getDefaultValueAST(
  argOrInputField: GraphQLArgument | GraphQLInputField,
): ConstValueNode | undefined {
  const type = argOrInputField.type;
  const defaultInput = argOrInputField.default;
  if (defaultInput) {
    const literal =
      defaultInput.literal ?? valueToLiteral(defaultInput.value, type);
    if (!(literal != null)) invariant(false, 'Invalid default value');
    return literal;
  }
  const defaultValue = argOrInputField.defaultValue;
  if (defaultValue !== undefined) {
    // eslint-disable-next-line import/no-deprecated
    const valueAST = astFromValue(defaultValue, type);
    if (!(valueAST != null)) invariant(false, 'Invalid default value');
    return valueAST;
  }
  return undefined;
}
