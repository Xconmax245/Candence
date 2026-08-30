// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CandenceMath
 * @notice Onchain bigint price/size snapping — the contract-side enforcement of
 *         DIRECTIVE §1.7 gotchas #3 (never off-tick prices) and #6 (always
 *         lot-quantized sizes). The offchain `pricing.ts` mirrors this exactly so
 *         we never even *sign* an order the chain would reject with InvalidPrice.
 *
 *         All values are integer base units. There is deliberately no float path.
 */
library CandenceMath {
    error PriceOutOfRange();
    error BadTick();
    error BadLot();

    /**
     * @notice Snap a raw price to the tick grid, clamped to the open interval
     *         (0, scale). Rounds down to the nearest tick.
     * @param rawPrice Desired price in base units (may be off-grid).
     * @param tick     Tick size in base units (> 0).
     * @param scale    Price scale == 1.0 in base units (e.g. 1e6 on testnet).
     */
    function snapPrice(uint256 rawPrice, uint256 tick, uint256 scale)
        internal
        pure
        returns (uint256)
    {
        if (tick == 0) revert BadTick();
        if (scale == 0 || tick >= scale) revert BadTick();
        uint256 snapped = (rawPrice / tick) * tick;
        if (snapped == 0) snapped = tick; // never 0 (probability > 0)
        if (snapped >= scale) snapped = scale - tick; // never >= 1 (probability < 1)
        return snapped;
    }

    /**
     * @notice Quantize a size down to the pool lot grid (§1.7 #6). Rounding DOWN
     *         guarantees we never exceed an authorized spend by a rounding lot.
     */
    function quantizeSize(uint256 size, uint256 lot) internal pure returns (uint256) {
        if (lot == 0) revert BadLot();
        return (size / lot) * lot;
    }

    /**
     * @notice Notional collateral cost of an order = price * size / scale, in
     *         collateral base units. This is the value the spend cap is checked
     *         against (the max the owner's wallet can be asked to escrow).
     */
    function notional(uint256 price, uint256 size, uint256 scale)
        internal
        pure
        returns (uint256)
    {
        if (scale == 0) revert BadTick();
        return (price * size) / scale;
    }

    /**
     * @notice Interval-scaled time headroom check (§1.7 #9). A fixed buffer breaks
     *         short windows; require ≥ 15% of the interval (min 20s) remaining.
     */
    function hasHeadroom(uint256 nowSec, uint256 expirySec, uint256 intervalSec)
        internal
        pure
        returns (bool)
    {
        if (expirySec <= nowSec) return false;
        uint256 pct = (intervalSec * 15) / 100;
        uint256 buffer = pct < 20 ? 20 : pct;
        return (expirySec - nowSec) >= buffer;
    }
}
