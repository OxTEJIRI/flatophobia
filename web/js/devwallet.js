// Local testing only. With `?local&devwallet=N` on localhost, this stands in for a browser wallet,
// signing as anvil's unlocked test account N. It does nothing anywhere else.
const params = new URLSearchParams(location.search);
const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

if (localHost && params.has("local") && params.has("devwallet")) {
  const idx = Number(params.get("devwallet") || 0);
  const rpc = "http://127.0.0.1:8545";
  let id = 0, accounts = null;
  const call = async (method, p = []) => {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: p }) }).then((x) => x.json());
    if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code, data: r.error.data });
    return r.result;
  };
  window.ethereum = {
    isDevWallet: true,
    async request({ method, params: p = [] }) {
      if (!accounts) accounts = await call("eth_accounts");
      const me = accounts[idx];
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts": return [me];
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain": return null;
        case "eth_sendTransaction": return call("eth_sendTransaction", [{ ...p[0], from: me }]);
        default: return call(method, p);
      }
    },
    on() {},
    removeListener() {},
  };
  console.info(`[devwallet] signing as anvil account #${idx}`);
}
