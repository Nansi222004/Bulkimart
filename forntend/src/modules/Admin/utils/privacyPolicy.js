export function privacyPolicyError(policy) {
  if (!policy.roleTitle?.trim()) return 'Policy title is required';
  if (!policy.version?.trim()) return 'Policy version is required';
  const date = new Date(policy.effectiveDate);
  if (!policy.effectiveDate || Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== policy.effectiveDate) return 'Enter a valid effective date';
  for (let index = 0; index < policy.sections.length; index++) {
    if (!policy.sections[index].title?.trim()) return `Section ${index + 1}: title is required`;
    if (!policy.sections[index].content?.trim()) return `Section ${index + 1}: content is required`;
  }
  return '';
}
