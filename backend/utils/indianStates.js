// Indian states and union territories with their GST state codes. Addresses are typed freely
// ("Madhya Pradesh", "MP", "Mp"), so a state is matched on letters only, by name or common short form.
const STATES = [
  ['01', 'Jammu and Kashmir', ['jk']], ['02', 'Himachal Pradesh', ['hp']], ['03', 'Punjab', ['pb']],
  ['04', 'Chandigarh', ['ch']], ['05', 'Uttarakhand', ['uk', 'uttaranchal']], ['06', 'Haryana', ['hr']],
  ['07', 'Delhi', ['dl', 'newdelhi', 'nctofdelhi']], ['08', 'Rajasthan', ['rj']], ['09', 'Uttar Pradesh', ['up']],
  ['10', 'Bihar', ['br']], ['11', 'Sikkim', ['sk']], ['12', 'Arunachal Pradesh', ['ar']], ['13', 'Nagaland', ['nl']],
  ['14', 'Manipur', ['mn']], ['15', 'Mizoram', ['mz']], ['16', 'Tripura', ['tr']], ['17', 'Meghalaya', ['ml']],
  ['18', 'Assam', ['as']], ['19', 'West Bengal', ['wb']], ['20', 'Jharkhand', ['jh']], ['21', 'Odisha', ['od', 'or', 'orissa']],
  ['22', 'Chhattisgarh', ['cg', 'ct', 'chattisgarh']], ['23', 'Madhya Pradesh', ['mp']], ['24', 'Gujarat', ['gj']],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu', ['dnh', 'dd', 'damananddiu', 'dadraandnagarhaveli']],
  ['27', 'Maharashtra', ['mh']], ['29', 'Karnataka', ['ka']], ['30', 'Goa', ['ga']], ['31', 'Lakshadweep', ['ld']],
  ['32', 'Kerala', ['kl']], ['33', 'Tamil Nadu', ['tn']], ['34', 'Puducherry', ['py', 'pondicherry']],
  ['35', 'Andaman and Nicobar Islands', ['an']], ['36', 'Telangana', ['ts', 'tg']], ['37', 'Andhra Pradesh', ['ap']],
  ['38', 'Ladakh', ['la']],
];
const letters = value => String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const LOOKUP = new Map(STATES.flatMap(([code, name, aliases]) => [letters(name), ...aliases].map(key => [key, { code, name }])));

/** `{ code, name }` for a typed state, or null when it cannot be recognised. */
export const resolveIndianState = value => LOOKUP.get(letters(value)) || null;

/** `{ code, name }` for a GST state code such as "23" (the first two digits of a GSTIN). */
export const indianStateByCode = code => {
  const row = STATES.find(([stateCode]) => stateCode === String(code));
  return row ? { code: row[0], name: row[1] } : null;
};
