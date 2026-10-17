/** Consume a startup login link once, including React StrictMode effect replay. */
export function createFragmentLogin() {
  let pending: Promise<unknown> | null = null;
  return (
    location: Pick<Location, "hash" | "pathname" | "search">,
    history: Pick<History, "replaceState" | "state">,
    login: (token: string) => Promise<unknown>,
  ): Promise<unknown> | null => {
    if (pending) return pending;
    const parameters = new URLSearchParams(location.hash.slice(1));
    if (!parameters.has("token")) return null;
    // Remove the credential before starting any asynchronous work. Preserve the
    // router's history state, but never store the token there or in storage.
    history.replaceState(history.state, "", location.pathname + location.search);
    const token = parameters.get("token") ?? "";
    if (parameters.getAll("token").length !== 1 || !token || token.length > 4096 || /\s/.test(token)) {
      pending = Promise.reject(new Error("The login link does not contain a valid server token."));
    } else {
      pending = Promise.resolve().then(() => login(token));
    }
    return pending;
  };
}
