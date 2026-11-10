# Security notes

This is a hackathon project. The contract has not had an independent security audit. Do not treat the game as a source of income. Only use tokens you can afford to lose.

## Settlement randomness

Settlement reads a recent block hash and combines it with the round ID and contract address to choose the hidden round end. Block hashes are not a verifiable random source. A block producer may have limited influence over them, and settlement timing can be influenced by who submits the permissionless settlement transactions. Here the hash chooses a time within the round's candle window, which affects which late settlers count. It does not select a payout winner directly.

The implementation reseals if settlement misses the block-hash availability window. A future production version should use a verifiable randomness source supported by Robinhood Chain, or replace the hidden-end mechanic with a design that does not depend on block-hash randomness.

## Contract properties

- The game contract has no owner, administrator, or upgrade path.
- Stakes transfer in $WIF. Settled claims transfer $WIF back out through pull-based claims.
- Contract writes use a reentrancy guard and update claim state before transferring tokens.
- Settlement, jackpot funding, and claims are permissionless where the caller cannot change the outcome or recipient.
- The local Foundry tests include payout conservation and settlement edge cases. They are not a substitute for an independent audit.

## Before mainnet deployment

- Review the exact deployed source and verify the contract on Robinhood Chain's block explorer.
- Test the deployed bytecode and token transfer behavior against the intended $WIF contract.
- Exercise multiple-wallet rounds, late drops, expired seals, void refunds, jackpot payouts, and claim retries on a public test environment.
- Confirm the live frontend points to the verified contract and displays its address and relevant transaction links.
- Keep the live frontend honest about token volatility, transaction costs, and the randomness limitation.

## Reporting

Please report suspected vulnerabilities privately to the project maintainer before making them public.
