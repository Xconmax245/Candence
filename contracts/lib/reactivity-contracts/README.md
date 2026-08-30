# @somnia-chain/reactivity-contracts

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](./package.json)

Solidity contracts and interfaces for building reactive smart contracts on Somnia.

This package provides:
- `ISomniaReactivityPrecompile`: precompile interface for subscription management.
- `SomniaExtensions`: helper library for creating and managing subscriptions.
- `ISomniaEventHandler` standard interface for event handlers.
- `SomniaEventHandler`: abstract base contract for secure callback handling.

## Installation

```bash
npm install @somnia-chain/reactivity-contracts
# or
yarn add @somnia-chain/reactivity-contracts
```

For Foundry projects, install this repository with `forge install`.

## Solidity Version

Contracts in this package use:

```solidity
pragma solidity 0.8.30;
```

## Contract Overview

### `SomniaEventHandler`

File: `contracts/SomniaEventHandler.sol`

- Implements `ISomniaEventHandler` and `IERC165`.
- Exposes external `onEvent(address,bytes32[],bytes)`.
- Restricts callback execution to the Somnia reactivity precompile at `address(0x0100)`.
- Implements `supportsInterface(bytes4)` (ERC-165) so the precompile can verify handler compatibility.
- Reverts with `OnlyReactivityPrecompile()` when called from an unauthorized address.
- Requires child contracts to implement:

```solidity
function _onEvent(
    address emitter,
    bytes32[] calldata eventTopics,
    bytes calldata data
) internal virtual;
```

### `ISomniaReactivityPrecompile`

File: `contracts/interfaces/ISomniaReactivityPrecompile.sol`

Defines:
- `SubscriptionData` struct.
- System events: `BlockTick(uint64 indexed blockNumber)`, `EpochTick(uint64 indexed epochNumber, uint64 indexed blockNumber)`, `Schedule(uint256 indexed timestampMillis)`.
- Subscription events: `SubscriptionCreated`, `SubscriptionRemoved`.
- Methods:
  - `subscribe(SubscriptionData) → uint256 subscriptionId`
  - `unsubscribe(uint256 subscriptionId)`
  - `getSubscriptionInfo(uint256 subscriptionId) → (SubscriptionData memory, address owner)`

### `SomniaExtensions`

File: `contracts/interfaces/SomniaExtensions.sol`

Library that wraps precompile interactions and provides ergonomic helpers.

Constants:
- `SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS = address(0x0100)`
- `SUBSCRIPTION_OWNER_MINIMUM_BALANCE = 32 ether`
- `MINIMUM_BASE_FEE_PER_GAS = 6 gwei`
- `MAXIMUM_HANDLER_GAS_LIMIT = 200_000_000`
- `DEFAULT_PRIORITY_FEE_PER_GAS = 0`
- `DEFAULT_MAX_FEE_PER_GAS = 20 gwei`
- `DEFAULT_HANDLER_GAS_LIMIT = 10_000_000`

Methods:
- `subscribe(address handler, SubscriptionFilter memory filter, SubscriptionOptions memory options) → uint256 subscriptionId`
- `scheduleSubscriptionAtTimestamp(address handler, uint256 timestampMillis, SubscriptionOptions memory options) → uint256 subscriptionId`
- `scheduleSubscriptionAtBlock(address handler, uint64 blockNumber, SubscriptionOptions memory options) → uint256 subscriptionId`
- `scheduleSubscriptionAtEpoch(address handler, uint64 epochNumber, SubscriptionOptions memory options) → uint256 subscriptionId`
- `unsubscribe(uint256 subscriptionId)`
- `getSubscriptionInfo(uint256 subscriptionId) → (SubscriptionData memory, address owner)`
- `defaultSubscriptionOptions() → SubscriptionOptions memory` — returns the library defaults

Helper structs:
- `SubscriptionFilter { bytes32[4] eventTopics, address origin, address emitter }`
- `SubscriptionOptions { uint64 priorityFeePerGas, uint64 maxFeePerGas, uint64 gasLimit }`

Errors:
- `HandlerZeroAddress()` — handler address is zero
- `EmptyFilter()` — all filter fields are wildcards
- `GasLimitZero()` — `options.gasLimit` is 0
- `GasLimitExceeded()` — `options.gasLimit` exceeds `MAXIMUM_HANDLER_GAS_LIMIT`
- `InvalidMaxFeePerGas()` — `maxFeePerGas` is non-zero but less than `priorityFeePerGas + MINIMUM_BASE_FEE_PER_GAS`
- `InsufficientBalance()` — calling contract balance is below `SUBSCRIPTION_OWNER_MINIMUM_BALANCE`
- `TimestampInPast()` — requested timestamp is not in the future
- `BlockInPast()` — requested block number is not in the future
- `UnsubscribeFailed()` — low-level call to the precompile's `unsubscribe` reverted

## Usage

### 1. Implement a Handler

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";

contract MyHandler is SomniaEventHandler {
    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        // Implement your reaction logic here.
        // onEvent is already protected so only the precompile can call it.
        emitter;
        eventTopics;
        data;
    }
}
```

### 2. Create Subscriptions with `SomniaExtensions`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

contract SubscriptionManager {
    function createTransferSubscription(address handler, address token)
        external
        returns (uint256)
    {
        SomniaExtensions.SubscriptionFilter memory filter = SomniaExtensions.SubscriptionFilter({
            eventTopics: [
                keccak256("Transfer(address,address,uint256)"),
                bytes32(0),
                bytes32(0),
                bytes32(0)
            ],
            origin: address(0),
            emitter: token
        });

        SomniaExtensions.SubscriptionOptions memory options = SomniaExtensions.SubscriptionOptions({
            priorityFeePerGas: 1 gwei,
            maxFeePerGas: 10 gwei,
            gasLimit: 10_000_000
        });

        return SomniaExtensions.subscribe(handler, filter, options);
    }
}
```

## Security Notes

- `SomniaEventHandler.onEvent` enforces `msg.sender == address(0x0100)` via `SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS`.
- `SomniaExtensions` validates handler address, filter presence, gas limits, fee configuration, and minimum owner balance before subscribing.
- Ensure your `_onEvent` logic is safe against reentrancy and unintended side effects.

## Repository Structure

- `contracts/SomniaEventHandler.sol`
- `contracts/interfaces/IERC165.sol`
- `contracts/interfaces/ISomniaEventHandler.sol`
- `contracts/interfaces/ISomniaReactivityPrecompile.sol`
- `contracts/interfaces/SomniaExtensions.sol`

## Documentation

Official docs: https://docs.somnia.network/developer/reactivity

## Testing
Tests are located in the `test/` directory and can be run with Foundry:

```bash
forge test
```

Additional live testing can be done on the Somnia testnet using the example package script:

```bash
cd ../example
npm install
npm run live -- https://your-rpc-url 0xYOUR_PRIVATE_KEY
```

## License

MIT - see [LICENSE](./LICENSE)