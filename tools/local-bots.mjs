// Local anvil only: has unlocked test accounts 1..N drop settlers, so the live arena has company.
// Usage: node tools/local-bots.mjs [players=4] [dropsEach=1]
import { ethers } from "../web/vendor/ethers.min.js";

const RPC = "http://127.0.0.1:8545";
const GAME = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const WIF = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const players = Number(process.argv[2] || 4);
const each = Number(process.argv[3] || 1);

const provider = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true });
const game = new ethers.Contract(GAME, ["function drop(uint8 cell)", "function dropsBy(uint256,address) view returns (uint256)", "function currentRound() view returns (uint256)"], provider);
const wif = new ethers.Contract(WIF, ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"], provider);

for (let p = 1; p <= players; p++) {
  const signer = await provider.getSigner(p);
  const me = await signer.getAddress();
  if ((await wif.allowance(me, GAME)) < 10n ** 22n) await (await wif.connect(signer).approve(GAME, 10n ** 24n)).wait();
  for (let d = 0; d < each; d++) {
    const cell = Math.floor(Math.random() * 80);
    try {
      await (await game.connect(signer).drop(cell)).wait();
      console.log(`player ${p} ${me.slice(0, 8)} dropped on cell ${cell} (ring ${Math.floor(cell / 16) + 1})`);
    } catch (e) {
      console.log(`player ${p} skipped: ${e.shortMessage || e.message}`);
    }
  }
}
