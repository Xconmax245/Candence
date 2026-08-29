/**
 * Candence contract ABIs (human-readable, viem-compatible).
 *
 * Kept in lock-step with the Solidity in `contracts/`. Only the events + external
 * functions the offchain stack actually consumes are listed — the telemetry
 * events here ARE the raw feed for the reliability dashboard (DIRECTIVE §6), so
 * they must match the emitting contracts exactly.
 *
 * DreamDEX/Somnia protocol ABIs are NOT redefined here — import those from
 * `@somnia-chain/markets-sdk` (binaryModuleReadAbi, ..., §1.4).
 */

/**
 * ReactivitySubscriber.sol — telemetry source of record (§4.1, §6).
 * Kept in EXACT lock-step with the deployed contract: the dashboard (§6) and the
 * fallback watcher (§4.5) decode against these signatures, so any drift here
 * silently breaks live telemetry. Verified against ReactivitySubscriber.sol.
 */
export const reactivitySubscriberAbi = [
  // ── Telemetry (raw feed for §6 dashboard) ──
  "event HandlerSucceeded(address indexed vault, bytes32 indexed marketKey, uint64 latencyMs, uint256 blockNumber)",
  "event HandlerFailed(address indexed vault, bytes32 indexed marketKey, string reason)",
  "event HandlerSkipped(address indexed vault, bytes32 indexed marketKey, string reason)",
  "event FallbackTriggered(address indexed vault, bytes32 indexed marketKey, address caller)",
  "event SubscriptionUpdated(uint256 indexed subscriptionId, bool active)",
  "event PriceSourceSet(address indexed emitter, bytes32 topic)",
  "event Paused(bool paused)",
  "event VaultRegistered(address indexed vault)",
  "event VaultDeregistered(address indexed vault)",
  // ── Reactive callback path (precompile-driven, §4.1) ──
  "function onReactiveEvent(uint256 subscriptionId, address emitter, bytes32 topic, bytes data)",
  "function submitFallbackTrigger(bytes32 marketKey, bytes data)",
  // ── Onchain telemetry counters — drift-free dashboard source (§6) ──
  "function counters() view returns (uint256 succeeded, uint256 failed, uint256 skipped)",
  "function succeededCount() view returns (uint256)",
  "function failedCount() view returns (uint256)",
  "function skippedCount() view returns (uint256)",
  "function fallbackActivations() view returns (uint256)",
  // ── Subscription lifecycle + SOMI funding (§4.3) ──
  "function subscribe() payable returns (uint256 subscriptionId)",
  "function cancelSubscription()",
  "function fundGas() payable",
  "function gasBalance() view returns (uint256)",
  "function subscriptionId() view returns (uint256)",
  // ── Admin: price source (timelocked, §4.1) ──
  "function queueSetPriceSource(address emitter, bytes32 topic)",
  "function executeSetPriceSource(address emitter, bytes32 topic)",
  "function priceSource() view returns (address)",
  "function priceTopic() view returns (bytes32)",
  // ── Admin: pause (freeze instant, unpause timelocked, §4.1) ──
  "function pause()",
  "function queueUnpause()",
  "function executeUnpause()",
  "function paused() view returns (bool)",
  // ── Vault registry ──
  "function registerVault(address vault)",
  "function deregisterVault(address vault)",
  "function isVaultRegistered(address vault) view returns (bool)",
  "function vaultCount() view returns (uint256)",
  "function vaults(uint256 index) view returns (address)",
  // ── Fallback watcher allowlist (§4.5) ──
  "function setFallbackWatcher(address watcher, bool allowed)",
  "function isFallbackWatcher(address watcher) view returns (bool)",
] as const;

/** AgentVault.sol — operator, never custodian (§1.6, §4.2). */
export const agentVaultAbi = [
  "event OrderPlaced(address indexed owner, bytes32 indexed marketKey, uint8 outcome, uint256 sizeBase, uint256 priceTick)",
  "event ModeSet(uint8 mode)",
  "event OwnerGranted(address indexed owner, uint256 spendCapBase)",
  "event OwnerRevoked(address indexed owner)",
  "event SignalUsed(bytes32 indexed marketKey, int32 scoreBps, uint16 confidenceBps)",
  "event FellBackToReactive(bytes32 indexed marketKey, string reason)",
  "event ClaimSwept(bytes32 indexed marketKey, uint8 outcome, uint256 amount, bool voided)",
  "event SomiLow(uint256 balance, uint256 threshold)",
  "function mode() view returns (uint8)",
  "function strategyId() view returns (uint256)",
  "function handleReactiveEvent(bytes32 marketKey, bytes data)",
  "function grantOwner(address owner, uint256 spendCapBase)",
  "function revokeOwner(address owner)",
  "function spentBase(address owner) view returns (uint256)",
  "function spendCapBase(address owner) view returns (uint256)",
  "function ownerList() view returns (address[])",
  "function somiBalance() view returns (uint256)",
  "function topUp() payable",
  "function setSignalSource(address copilotAttestor)",
] as const;

/**
 * AgentVaultFactory.sol — deploys vaults, mints strategy NFTs (§4.2).
 * Verified against AgentVaultFactory.sol: deployVault takes (name, mode,
 * deployerSpendCapBase, tokenUri); enumeration is getAllVaults()/vaultCount()
 * (allVaults/vaultsOf are index getters, NOT whole-array returns).
 */
export const agentVaultFactoryAbi = [
  "event VaultDeployed(address indexed vault, uint256 indexed strategyId, address indexed deployer, uint8 mode)",
  "event StrategyCloned(address indexed vault, address indexed newOwner, uint256 spendCapBase)",
  "event SubscriberSet(address indexed subscriber)",
  "function deployVault(string name, uint8 mode, uint256 deployerSpendCapBase, string tokenUri) returns (address vault, uint256 strategyId)",
  "function cloneAgent(address vault, uint256 spendCapBase)",
  "function getAllVaults() view returns (address[])",
  "function vaultCount() view returns (uint256)",
  "function allVaults(uint256 index) view returns (address)",
  "function vaultsOf(address deployer, uint256 index) view returns (address)",
  "function strategyIdOf(address vault) view returns (uint256)",
  "function nextStrategyId() view returns (uint256)",
  "function subscriber() view returns (address)",
  "function setSubscriber(address subscriber)",
  "function setDefaults(uint256 drawdownThresholdBase, uint256 basePositionBase)",
] as const;

/** RiskEngine.sol — onchain spend caps + circuit breakers (§4.4). */
export const riskEngineAbi = [
  "event CircuitBreakerTripped(address indexed vault, int256 drawdownBase, uint256 threshold)",
  "event VaultPaused(address indexed vault, bool paused)",
  "event GlobalPauseSet(bool paused)",
  "event DrawdownThresholdSet(address indexed vault, uint256 thresholdBase)",
  "function checkSpend(address vault, address owner, uint256 amountBase) view returns (bool ok, string reason)",
  "function recordSettlement(address vault, int256 pnlBase, bool voided)",
  "function isVaultPaused(address vault) view returns (bool)",
  "function globalPaused() view returns (bool)",
  "function positionCapBase(address vault) view returns (uint256)",
  "function realizedDrawdownBase(address vault) view returns (int256)",
] as const;

/** StrategyNFT.sol — ERC-721, soulbound-gated (§4.4). */
export const strategyNftAbi = [
  "event StrategyMinted(uint256 indexed tokenId, address indexed to, address indexed vault)",
  "event TransferAllowlisted(address indexed account, bool allowed)",
  "function mint(address to, address vault, string tokenURI) returns (uint256 tokenId)",
  "function vaultOf(uint256 tokenId) view returns (address)",
  "function setTransferAllowed(address account, bool allowed)",
  "function isTransferAllowed(address account) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
] as const;

/** CopilotAttestor.sol — onchain registry of AI signal correctness (§5, §6). */
export const copilotAttestorAbi = [
  "event SignalPosted(bytes32 indexed windowKey, int32 scoreBps, uint16 confidenceBps, uint64 issuedAt)",
  "event SignalGraded(bytes32 indexed windowKey, bool correct)",
  "function postSignal(bytes32 windowKey, int32 scoreBps, uint16 confidenceBps, uint64 issuedAt, bytes signature)",
  "function gradeSignal(bytes32 windowKey, bool correct)",
  "function latestSignal(bytes32 windowKey) view returns (int32 scoreBps, uint16 confidenceBps, uint64 issuedAt, bool graded, bool correct)",
  "function signer() view returns (address)",
] as const;

export const CANDENCE_CONTRACTS = [
  "ReactivitySubscriber",
  "AgentVault",
  "AgentVaultFactory",
  "RiskEngine",
  "StrategyNFT",
  "CopilotAttestor",
] as const;
