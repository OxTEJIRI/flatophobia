# Flatophobia

The world is a flat disc balanced on a pin. Everyone drops settlers on it. Each drop tilts the world toward its position. When a round ends, the low edge slides off and the survivors split what fell.

Flatophobia is a shared-world strategy game built for the World Is Flat hackathon on Robinhood Chain. The game uses $WIF for equal-stake entries, settlement, burns, and a growing jackpot.

## Play

Open `web/index.html` from a local static server. Practice mode works without a wallet or a deployed contract. Live mode reads the configured Robinhood Chain contract and uses an EVM wallet for transactions.

For local development, serve the repository root with any static server and open `web/`. For example:

```sh
python -m http.server 5181
```

Then visit `http://localhost:5181/web/`.

## Contracts

The Solidity project is in `contracts/` and uses Foundry. Install Foundry and the `forge-std` dependency before building or running its tests.

```sh
cd contracts
forge build
forge test
```

`web/js/config.js` contains the Robinhood Chain mainnet network settings, the $WIF address, and the game contract address. The game address is blank until a mainnet deployment. Local mode can be selected with `?local` after deploying the local script.

## Project structure

- `web/` contains the static browser game, bundled Three.js and ethers libraries, and map data.
- `contracts/src/Flatophobia.sol` contains the game contract.
- `contracts/test/` contains the Foundry tests.
- `tools/` contains local simulations, bots, and map data utilities.
- `DESIGN.md` describes the game rules, economy, interface, and remaining work.
- `SECURITY.md` records the current design risks and deployment checks.

## Security

The contract settles rounds using a block hash to choose a hidden end time. Block data is not secure randomness. The influence is limited to the round timing, and this assumption is documented in `SECURITY.md`. The contract has no upgrade or admin mechanism, so deployed logic cannot be changed.

The project has not been deployed to Robinhood Chain mainnet. Live play and production deployment still need validation.

## License

MIT
