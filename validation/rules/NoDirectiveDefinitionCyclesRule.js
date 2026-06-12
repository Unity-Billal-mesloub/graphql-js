"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoDirectiveDefinitionCyclesRule = NoDirectiveDefinitionCyclesRule;
const GraphQLError_ts_1 = require("../../error/GraphQLError.js");
const kinds_ts_1 = require("../../language/kinds.js");
function NoDirectiveDefinitionCyclesRule(context) {
    const visitedDirectives = Object.create(null);
    const referencePath = [];
    const referencePathIndexByKey = Object.create(null);
    const referencesByKey = Object.create(null);
    const schema = context.getSchema();
    if (schema != null) {
        for (const directive of schema.getDirectives()) {
            const key = '@' + directive.name;
            for (const node of [directive.astNode, ...directive.extensionASTNodes]) {
                if (node != null) {
                    addReferenceOwnerReferences(key, node, false);
                }
            }
        }
        for (const type of Object.values(schema.getTypeMap())) {
            for (const node of [type.astNode, ...type.extensionASTNodes]) {
                if (node != null) {
                    addReferenceOwnerReferences(type.name, node, false);
                }
            }
        }
    }
    return {
        DirectiveDefinition: collectReferenceOwnerReferences,
        DirectiveExtension: collectReferenceOwnerReferences,
        ScalarTypeDefinition: collectReferenceOwnerReferences,
        ScalarTypeExtension: collectReferenceOwnerReferences,
        ObjectTypeDefinition: collectReferenceOwnerReferences,
        ObjectTypeExtension: collectReferenceOwnerReferences,
        InterfaceTypeDefinition: collectReferenceOwnerReferences,
        InterfaceTypeExtension: collectReferenceOwnerReferences,
        UnionTypeDefinition: collectReferenceOwnerReferences,
        UnionTypeExtension: collectReferenceOwnerReferences,
        EnumTypeDefinition: collectReferenceOwnerReferences,
        EnumTypeExtension: collectReferenceOwnerReferences,
        InputObjectTypeDefinition: collectReferenceOwnerReferences,
        InputObjectTypeExtension: collectReferenceOwnerReferences,
        Document: {
            leave() {
                for (const key of Object.keys(referencesByKey)) {
                    if (key.startsWith('@')) {
                        detectCycleRecursive(key);
                    }
                }
            },
        },
    };
    function collectReferenceOwnerReferences(node) {
        const key = node.kind === kinds_ts_1.Kind.DIRECTIVE_DEFINITION ||
            node.kind === kinds_ts_1.Kind.DIRECTIVE_EXTENSION
            ? '@' + node.name.value
            : node.name.value;
        addReferenceOwnerReferences(key, node, true);
        return false;
    }
    function detectCycleRecursive(key) {
        if (key.startsWith('@')) {
            if (visitedDirectives[key]) {
                return;
            }
            visitedDirectives[key] = true;
        }
        referencePathIndexByKey[key] = referencePath.length;
        for (const reference of referencesByKey[key] ?? []) {
            const cycleIndex = referencePathIndexByKey[reference.key];
            referencePath.push(reference);
            if (cycleIndex === undefined) {
                detectCycleRecursive(reference.key);
            }
            else if (reference.key.startsWith('@')) {
                const cyclePath = referencePath.slice(cycleIndex);
                if (cyclePath.some((cycleReference) => cycleReference.isFromDocument)) {
                    reportCycle(reference.key.slice(1), cyclePath.map((cycleReference) => cycleReference.node));
                }
            }
            referencePath.pop();
        }
        referencePathIndexByKey[key] = undefined;
    }
    function addReferenceOwnerReferences(key, node, isFromDocument) {
        addDirectiveReferences(key, node.directives, isFromDocument);
        switch (node.kind) {
            case kinds_ts_1.Kind.DIRECTIVE_DEFINITION:
                addInputValueDefinitionReferences(key, node.arguments, isFromDocument);
                break;
            case kinds_ts_1.Kind.DIRECTIVE_EXTENSION:
            case kinds_ts_1.Kind.SCALAR_TYPE_DEFINITION:
            case kinds_ts_1.Kind.SCALAR_TYPE_EXTENSION:
                break;
            case kinds_ts_1.Kind.OBJECT_TYPE_DEFINITION:
            case kinds_ts_1.Kind.OBJECT_TYPE_EXTENSION:
            case kinds_ts_1.Kind.INTERFACE_TYPE_DEFINITION:
            case kinds_ts_1.Kind.INTERFACE_TYPE_EXTENSION:
                addNamedTypeReferences(key, node.interfaces, isFromDocument);
                addFieldDefinitionReferences(key, node.fields, isFromDocument);
                break;
            case kinds_ts_1.Kind.UNION_TYPE_DEFINITION:
            case kinds_ts_1.Kind.UNION_TYPE_EXTENSION:
                addNamedTypeReferences(key, node.types, isFromDocument);
                break;
            case kinds_ts_1.Kind.ENUM_TYPE_DEFINITION:
            case kinds_ts_1.Kind.ENUM_TYPE_EXTENSION:
                addEnumValueDefinitionReferences(key, node.values, isFromDocument);
                break;
            case kinds_ts_1.Kind.INPUT_OBJECT_TYPE_DEFINITION:
            case kinds_ts_1.Kind.INPUT_OBJECT_TYPE_EXTENSION:
                addInputValueDefinitionReferences(key, node.fields, isFromDocument);
                break;
        }
    }
    function addFieldDefinitionReferences(key, fields, isFromDocument) {
        for (const field of fields ?? []) {
            addDirectiveReferences(key, field.directives, isFromDocument);
            addInputValueDefinitionReferences(key, field.arguments, isFromDocument);
            addTypeReference(key, field.type, isFromDocument);
        }
    }
    function addInputValueDefinitionReferences(key, inputValues, isFromDocument) {
        for (const inputValue of inputValues ?? []) {
            addDirectiveReferences(key, inputValue.directives, isFromDocument);
            addTypeReference(key, inputValue.type, isFromDocument);
        }
    }
    function addEnumValueDefinitionReferences(key, enumValues, isFromDocument) {
        for (const enumValue of enumValues ?? []) {
            addDirectiveReferences(key, enumValue.directives, isFromDocument);
        }
    }
    function addDirectiveReferences(key, directives, isFromDocument) {
        for (const directive of directives ?? []) {
            addReference(key, directive, isFromDocument);
        }
    }
    function addNamedTypeReferences(key, nodes, isFromDocument) {
        for (const node of nodes ?? []) {
            addReference(key, node, isFromDocument);
        }
    }
    function addTypeReference(key, typeNode, isFromDocument) {
        let namedType = typeNode;
        while (namedType.kind === kinds_ts_1.Kind.LIST_TYPE ||
            namedType.kind === kinds_ts_1.Kind.NON_NULL_TYPE) {
            namedType = namedType.type;
        }
        addReference(key, namedType, isFromDocument);
    }
    function addReference(key, node, isFromDocument) {
        const referenceKey = node.kind === kinds_ts_1.Kind.DIRECTIVE ? '@' + node.name.value : node.name.value;
        referencesByKey[key] ??= [];
        referencesByKey[key].push({ key: referenceKey, node, isFromDocument });
    }
    function reportCycle(directiveName, cyclePath) {
        const viaPath = cyclePath.slice(0, -1).map(formatReference).join(', ');
        const referencesDescription = cyclePath.some((referenceNode) => referenceNode.kind === kinds_ts_1.Kind.NAMED_TYPE)
            ? ' through a series of references'
            : ' through a series of directive applications';
        context.reportError(new GraphQLError_ts_1.GraphQLError(`Cannot reference directive "@${directiveName}" within itself` +
            (viaPath !== ''
                ? `${referencesDescription}: ${viaPath}, "@${directiveName}".`
                : '.'), { nodes: cyclePath }));
    }
    function formatReference(referenceNode) {
        return referenceNode.kind === kinds_ts_1.Kind.DIRECTIVE
            ? '"@' + referenceNode.name.value + '"'
            : '"' + referenceNode.name.value + '"';
    }
}
//# sourceMappingURL=NoDirectiveDefinitionCyclesRule.js.map