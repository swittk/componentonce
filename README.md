# ComponentOnce

Small host-agnostic contracts for registering, loading, and rendering versioned application-specific components.

The initial target is trusted internal React components that can be compiled and loaded dynamically while receiving persisted component props, arbitrary host application context, and arbitrary per-render payload.

ComponentOnce itself does not own storage, transport, databases, Puck, FreelancerOnce, or Shinebright.
