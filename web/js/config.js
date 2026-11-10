// Network + contract addresses. `?local` runs against a local anvil chain (see tools/local.sh).
const params = new URLSearchParams(location.search);

const MAINNET = {
  label: "robinhood chain",
  chainId: 4663,
  rpc: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  wif: "0x5173b8eA6923c2d40267890D45C46a3480954773",
  // set after deployment; `?game=0x...` overrides it
  game: "",
  buyWif: "https://www.ponsfamily.com/launchpad/0x5173b8eA6923c2d40267890D45C46a3480954773",
};

const LOCAL = {
  label: "local anvil",
  chainId: 31337,
  rpc: "http://127.0.0.1:8545",
  explorer: "",
  wif: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  game: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  buyWif: "",
};

export const CONFIG = { ...(params.has("local") ? LOCAL : MAINNET) };
if (params.get("game")) CONFIG.game = params.get("game");
CONFIG.chainHex = "0x" + CONFIG.chainId.toString(16);
export const LIVE = /^0x[0-9a-fA-F]{40}$/.test(CONFIG.game);
