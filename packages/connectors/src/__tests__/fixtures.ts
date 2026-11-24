import { dec, type Instrument } from '@helm/shared'

export const btcusdtSpot: Instrument = {
  id: 'binance:spot:BTC-USDT', provider: 'binance', providerSymbol: 'BTCUSDT', product: 'spot', base: 'BTC', quote: 'USDT',
  contractMultiplier: dec('1'), quantityUnit: 'base', lotSize: dec('0.00001'), minQty: dec('0.00001'), minNotional: dec('5'),
  tickSize: dec('0.01'), venue: 'Binance Spot (Demo)', currency: 'USDT', status: 'trading',
}
export const btcusdtPerp: Instrument = { ...btcusdtSpot, id: 'binance:perp:BTC-USDT:USDT', product: 'perp', settle: 'USDT', lotSize: dec('0.001'), minQty: dec('0.001'), minNotional: dec('100'), tickSize: dec('0.1') }
export const okxSpot: Instrument = { ...btcusdtSpot, id: 'okx:spot:BTC-USDT', provider: 'okx', providerSymbol: 'BTC-USDT', lotSize: dec('0.00000001'), minQty: dec('0.00001'), minNotional: undefined }
export const okxSwap: Instrument = { ...okxSpot, id: 'okx:perp:BTC-USDT:USDT', providerSymbol: 'BTC-USDT-SWAP', product: 'perp', settle: 'USDT', quantityUnit: 'contracts', contractMultiplier: dec('0.01'), lotSize: dec('0.01'), minQty: dec('0.01'), tickSize: dec('0.1') }
export const bybitSpot: Instrument = { ...btcusdtSpot, id: 'bybit:spot:BTC-USDT', provider: 'bybit', minNotional: dec('1'), lotSize: dec('0.000001'), minQty: dec('0.000048') }
export const bybitLinear: Instrument = { ...bybitSpot, id: 'bybit:perp:BTC-USDT:USDT', product: 'perp', settle: 'USDT', lotSize: dec('0.001'), minQty: dec('0.001'), minNotional: dec('5'), tickSize: dec('0.1') }
export const cbSpot: Instrument = { ...btcusdtSpot, id: 'coinbase:spot:BTC-USD', provider: 'coinbase', providerSymbol: 'BTC-USD', quote: 'USD', currency: 'USD', minNotional: undefined }
export const aaplAlpaca: Instrument = { ...btcusdtSpot, id: 'alpaca:stock:AAPL:USD', provider: 'alpaca', providerSymbol: 'AAPL', product: 'stock', base: 'AAPL', quote: 'USD', quantityUnit: 'shares', lotSize: dec('0.000000001'), minQty: dec('0.000000001'), minNotional: undefined, currency: 'USD' }
export const aaplIbkr: Instrument = { ...aaplAlpaca, id: 'ibkr:stock:AAPL:USD', provider: 'ibkr', lotSize: dec('1'), minQty: dec('1'), raw: { conid: 265598 } }
