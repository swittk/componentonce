# @componentonce/react

React adapter for trusted ComponentOnce modules.

React is a peer dependency. Dynamically compiled modules must use the host application's actual React and JSX-runtime instances rather than bundling another React copy.

## Define and render

defineReactComponent<Props, HostContext, Payload> keeps persisted props, arbitrary host context, and per-render payload distinct.

Typed rendering does not revalidate values by default. Raw JSON/editor/storage boundaries can use validateReactComponentBoundary or renderReactComponentBoundary to validate props and payload once.

## React runtime compatibility

createReactRequirement(version) creates the generic core requirement named react.

When a definition declares requirements, renderReactComponent checks them against hostCapabilities before calling React createElement. Exact compatibility is the default. The host may supply capabilityCompatibility when it deliberately supports a version range.

This matters because sharing the host React singleton prevents duplicate-React hook failures, but it does not make a React-19-authored module compatible with a React-18 host automatically.

## Host-specific helpers

createReactHostHelpers<HostContext, Payload>() fixes application context/payload types without importing application code into ComponentOnce. Each component still chooses its own Props type.
