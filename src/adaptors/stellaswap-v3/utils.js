const BigNumber = require('bignumber.js');
const { request } = require('graphql-request');
const { pulsar, pulsarFarming, pulsarBlocks } = require('./clients')

const {
    queryBlock,
    queryPositions,
    queryFarming,
    queryDeposits,
    queryTokens,
    queryPositionsViaIds
} = require('./queries')

const tickToSqrtPrice = (tick) => {
    return new BigNumber(Math.sqrt(1.0001 ** tick));
};

exports.getPreviousBlockNumber = async () => {
    const startBlock = 2649799;
    const response = (await request(pulsarBlocks, queryBlock))
    const blockNumber = response.blocks[0]?.number === undefined ? startBlock : response.blocks[0]?.number;
    return blockNumber;
};

exports.getPositionsOfPool = async (poolId) => {
    const result = [];
    let i = 0;
    while (true) {
        const positions = (await request(pulsar, queryPositions.replace('<POOL_ID>', poolId)))
        result.push(...positions.positions);
        if (positions.positions.length < 1000) {
            break;
        }
        i += 1;
    }
    return result;
};

exports.getAmounts = (liquidity, tickLower, tickUpper, currentTick) => {
    const currentPrice = tickToSqrtPrice(currentTick);
    const lowerPrice = tickToSqrtPrice(tickLower);
    const upperPrice = tickToSqrtPrice(tickUpper);
    let amount1, amount0;
    if (currentPrice.isLessThan(lowerPrice)) {
        amount1 = new BigNumber(0);
        amount0 = liquidity.times(new BigNumber(1).div(lowerPrice).minus(new BigNumber(1).div(upperPrice)));
    } else if (currentPrice.isGreaterThanOrEqualTo(lowerPrice) && currentPrice.isLessThanOrEqualTo(upperPrice)) {
        amount1 = liquidity.times(currentPrice.minus(lowerPrice));
        amount0 = liquidity.times(new BigNumber(1).div(currentPrice).minus(new BigNumber(1).div(upperPrice)));
    } else {
        amount1 = liquidity.times(upperPrice.minus(lowerPrice));
        amount0 = new BigNumber(0);
    }
    return { amount0, amount1 };
};

exports.getEternalFarmingInfo = async () => {
    const eternalFarmings = await request(pulsarFarming, queryFarming);
    return eternalFarmings.eternalFarmings;
};

exports.getPositionsInEternalFarming = async (farmingId) => {
    const result = [];
    let i = 0;
    while (true) {
        const positions = (await request(pulsarFarming, queryDeposits.replace('<FARMING_ID>', farmingId)))
        result.push(...positions.deposits);
        if (positions.deposits.length < 1000) {
            break;
        }
        i += 1;
    }
    return result;
};

exports.getTokenInfoByAddress = async (tokenAddress) => {
    const tokens = (await request(pulsar, queryTokens.replace('<TOKEN_ADDRESS>', tokenAddress)))
    return tokens.tokens;
};

exports.getPositionsById = async (tokenIds) => {
    tokenIds = tokenIds.map((tokenId) => tokenId.id);
    const result = [];
    let i = 0;
    while (true) {
        const positions = (await request(pulsar, queryPositionsViaIds.replace('<TOKEN_IDS>', JSON.stringify(tokenIds))))
        result.push(...positions.positions);
        if (positions.positions.length < 1000) {
            break;
        }
        i += 1;
    }
    return result;
};