import { GraphQLError } from "../../error/GraphQLError.mjs";
import { Kind } from "../../language/kinds.mjs";
export function NoDirectiveDefinitionCyclesRule(context) {
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
        const key = node.kind === Kind.DIRECTIVE_DEFINITION ||
            node.kind === Kind.DIRECTIVE_EXTENSION
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
            case Kind.DIRECTIVE_DEFINITION:
                addInputValueDefinitionReferences(key, node.arguments, isFromDocument);
                break;
            case Kind.DIRECTIVE_EXTENSION:
            case Kind.SCALAR_TYPE_DEFINITION:
            case Kind.SCALAR_TYPE_EXTENSION:
                break;
            case Kind.OBJECT_TYPE_DEFINITION:
            case Kind.OBJECT_TYPE_EXTENSION:
            case Kind.INTERFACE_TYPE_DEFINITION:
            case Kind.INTERFACE_TYPE_EXTENSION:
                addNamedTypeReferences(key, node.interfaces, isFromDocument);
                addFieldDefinitionReferences(key, node.fields, isFromDocument);
                break;
            case Kind.UNION_TYPE_DEFINITION:
            case Kind.UNION_TYPE_EXTENSION:
                addNamedTypeReferences(key, node.types, isFromDocument);
                break;
            case Kind.ENUM_TYPE_DEFINITION:
            case Kind.ENUM_TYPE_EXTENSION:
                addEnumValueDefinitionReferences(key, node.values, isFromDocument);
                break;
            case Kind.INPUT_OBJECT_TYPE_DEFINITION:
            case Kind.INPUT_OBJECT_TYPE_EXTENSION:
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
        while (namedType.kind === Kind.LIST_TYPE ||
            namedType.kind === Kind.NON_NULL_TYPE) {
            namedType = namedType.type;
        }
        addReference(key, namedType, isFromDocument);
    }
    function addReference(key, node, isFromDocument) {
        const referenceKey = node.kind === Kind.DIRECTIVE ? '@' + node.name.value : node.name.value;
        referencesByKey[key] ??= [];
        referencesByKey[key].push({ key: referenceKey, node, isFromDocument });
    }
    function reportCycle(directiveName, cyclePath) {
        const viaPath = cyclePath.slice(0, -1).map(formatReference).join(', ');
        const referencesDescription = cyclePath.some((referenceNode) => referenceNode.kind === Kind.NAMED_TYPE)
            ? ' through a series of references'
            : ' through a series of directive applications';
        context.reportError(new GraphQLError(`Cannot reference directive "@${directiveName}" within itself` +
            (viaPath !== ''
                ? `${referencesDescription}: ${viaPath}, "@${directiveName}".`
                : '.'), { nodes: cyclePath }));
    }
    function formatReference(referenceNode) {
        return referenceNode.kind === Kind.DIRECTIVE
            ? '"@' + referenceNode.name.value + '"'
            : '"' + referenceNode.name.value + '"';
    }
}
//# sourceMappingURL=NoDirectiveDefinitionCyclesRule.js.map