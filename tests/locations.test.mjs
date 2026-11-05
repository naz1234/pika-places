import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, STATE_LABELS, TOWNS_BY_STATE, matchPlace, stateForTown, townSuggestions } from '../public/js/model.js';

test('all 13 Malaysian states and 3 federal territories have town and district options', () => {
  const examples = {
    Johor: 'Kluang', Kedah: 'Alor Setar', Kelantan: 'Kuala Krai', Melaka: 'Jasin',
    'Negeri Sembilan': 'Bahau', Pahang: 'Kuala Lipis', Penang: 'George Town', Perak: 'Ipoh',
    Perlis: 'Kangar', Sabah: 'Kalabakan', Sarawak: 'Bukit Mabong', Selangor: 'Kajang',
    Terengganu: 'Kuala Nerus', 'Kuala Lumpur': 'Kuala Lumpur', Labuan: 'Labuan', Putrajaya: 'Putrajaya'
  };
  assert.equal(STATES.length,16);
  assert.deepEqual(new Set(STATES),new Set(Object.keys(examples)));
  assert.deepEqual(new Set(Object.keys(TOWNS_BY_STATE)),new Set(STATES));
  for (const [state, example] of Object.entries(examples)) {
    const towns = townSuggestions(state);
    assert.ok(towns.includes(example),`${example} must be available under ${state}`);
    assert.equal(towns.length,new Set(towns.map(town => town.trim().toLowerCase())).size);
    assert.ok(towns.every(town => town === town.trim() && town.length <= 80));
  }
  assert.equal(STATE_LABELS.Penang,'Pulau Pinang');
  assert.equal(STATE_LABELS['Kuala Lumpur'],'W.P. Kuala Lumpur');
});

test('state and nama tempat combine without confusing towns that share a name', () => {
  const johor = {state:'Johor',area:'  Ayer Hitam  ',status:'want',category:'Food'};
  const kedah = {...johor,state:'Kedah',area:'Ayer Hitam'};
  assert.ok(matchPlace(johor,{state:'Johor',area:'ayer hitam',status:'want'}));
  assert.ok(!matchPlace(kedah,{state:'Johor',area:'Ayer Hitam'}));
  assert.ok(!matchPlace(johor,{state:'Johor',area:'Kluang'}));
  assert.ok(!matchPlace(johor,{state:'Johor',area:'Ayer Hitam',status:'visited'}));
  assert.ok(!matchPlace({state:'Perlis',area:'Kangar'},{area:'Perlis'}));
  assert.ok(matchPlace(kedah,{area:'Ayer Hitam'}));
  assert.ok(matchPlace({...johor,favourite:true},{view:'favourites',state:'Johor',area:'Ayer Hitam'}));
  assert.ok(matchPlace({...johor,deleted_at:'2026-01-01'},{view:'trash',state:'Johor',area:'Ayer Hitam'}));
});

test('custom areas stay available under their own state and ambiguous towns do not infer a state', () => {
  const places = [{state:'Johor',area:'  Permas Jaya  '},{state:'Johor',area:'permas jaya'}];
  assert.equal(townSuggestions('Johor',places).filter(town => town.toLowerCase() === 'permas jaya').length,1);
  assert.ok(!townSuggestions('Melaka',places).includes('Permas Jaya'));
  assert.equal(stateForTown('Kluang'),'Johor');
  assert.equal(stateForTown('Ayer Hitam'),'');
  assert.equal(stateForTown('Kepala Batas'),'');
  assert.equal(stateForTown('Permas Jaya',places),'Johor');
});
