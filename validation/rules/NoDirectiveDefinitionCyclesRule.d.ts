/** @category Validation Rules */
import type { ASTVisitor } from "../../language/visitor.js";
import type { SDLValidationContext } from "../ValidationContext.js";
/**
 * No directive definition cycles
 *
 * The graph of directives used within directive definitions must not form any
 * cycles including referencing itself. This includes directives used on
 * directive arguments and, when the experimental syntax is enabled, directives
 * applied directly to directive definitions and extensions.
 *
 * See https://spec.graphql.org/draft/#sec-Type-System.Directives
 * @param context - The validation context used while checking the document.
 * @returns A visitor that reports validation errors for this rule.
 * @example
 * ```ts
 * import { buildSchema } from 'graphql';
 * import { NoDirectiveDefinitionCyclesRule } from 'graphql/validation';
 *
 * const invalidSDL = `
 *   directive @a(arg: String @b) on ARGUMENT_DEFINITION
 *   directive @b(arg: String @a) on ARGUMENT_DEFINITION
 *   type Query { name: String }
 * `;
 *
 * NoDirectiveDefinitionCyclesRule.name; // => 'NoDirectiveDefinitionCyclesRule'
 * buildSchema(invalidSDL); // throws an error
 *
 * const validSDL = `
 *   directive @a(arg: String @b) on FIELD_DEFINITION
 *   directive @b on ARGUMENT_DEFINITION
 *   type Query { name: String }
 * `;
 *
 * buildSchema(validSDL); // does not throw
 * ```
 */
export declare function NoDirectiveDefinitionCyclesRule(context: SDLValidationContext): ASTVisitor;
