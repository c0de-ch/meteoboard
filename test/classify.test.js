const test = require('node:test');
const assert = require('node:assert');
const { classifySensor, buildSensorMap, normalize } = require('../scripts/lib/classify');

test('normalize coerces booleans and drops non-numerics', () => {
  assert.deepEqual(normalize([true, false, '3', 'x', null, 4]), [1, 0, 3, 4]);
});

test('classifySensor: unambiguous types', () => {
  assert.equal(classifySensor([0, 1, 0, 1]), 'rain_status');
  assert.equal(classifySensor([true, false, true]), 'rain_status');
  assert.equal(classifySensor([1010, 1012, 1008]), 'pressure');
  assert.equal(classifySensor([0, 50000, 1200]), 'illuminance');
  assert.equal(classifySensor([0, 90, 180, 270, 359]), 'wind_direction');
  assert.equal(classifySensor([18, 20, 22, 19]), 'temperature_like');
  assert.equal(classifySensor([55, 60, 90, 45]), 'humidity_like'); // max>=70 escapes temp
});

test('classifySensor: empty / non-numeric -> unknown', () => {
  assert.equal(classifySensor([]), 'unknown');
  assert.equal(classifySensor(['x', 'y']), 'unknown');
});

test('buildSensorMap: temperature vs dew point ordered by average', () => {
  const { map } = buildSensorMap({
    10: [20, 21, 22], // higher avg -> temperature
    11: [10, 11, 9],  // lower avg  -> dew_point
    12: [1010, 1011], // pressure
    13: [0, 1, 0],    // rain_status
    14: [0, 90, 350], // wind_direction
  });
  assert.equal(map.temperature, '10');
  assert.equal(map.dew_point, '11');
  assert.equal(map.pressure, '12');
  assert.equal(map.rain_status, '13');
  assert.equal(map.wind_direction, '14');
});

test('buildSensorMap: skips components with no usable values', () => {
  const { map, classified } = buildSensorMap({ 1: [], 2: [1010, 1011] });
  assert.equal(classified['1'], undefined);
  assert.equal(map.pressure, '2');
});
