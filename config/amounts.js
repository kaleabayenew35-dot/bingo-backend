const AMOUNTS = Object.freeze([10, 20, 30, 50, 100, 200]);

const PREFIX_BY_AMOUNT = Object.freeze({
  10: 'A',
  20: 'B',
  30: 'C',
  50: 'D',
  100: 'E',
  200: 'F',
});

function normalizeAmount(value) {
  const amount = Number(value);
  if (!AMOUNTS.includes(amount)) throw new Error('Invalid amount');
  return amount;
}

function tableNameForAmount(value) {
  return `amount_${normalizeAmount(value)}`;
}

function prefixForAmount(value) {
  return PREFIX_BY_AMOUNT[normalizeAmount(value)];
}

function gameIdFor(amount, sequence) {
  return `${prefixForAmount(amount)}${Number(sequence)}`;
}

module.exports = {
  AMOUNTS,
  PREFIX_BY_AMOUNT,
  normalizeAmount,
  tableNameForAmount,
  prefixForAmount,
  gameIdFor,
};
