# @componentonce/dom

Trusted ordinary DOM adapter for ComponentOnce.

A DOM component receives three independent typed channels: persisted props, host-owned context, and per-render payload. Its implementation mounts into a host-owned Element and returns explicit update and destroy lifecycle methods.

Typed mounts do not revalidate values unless explicitly requested. Use mountDomComponentBoundary when loading raw props or payload from storage or transport.
