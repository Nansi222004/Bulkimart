import { gstDecisionValid } from '../../../components/gst/gstApi';

export function sellerDocumentIssues({ uploadedDocs = {}, panNumber = '', gstDecision = {} }) {
  const issues = [];
  if (!uploadedDocs.aadhaarFront) issues.push('Upload Aadhaar front');
  if (!uploadedDocs.aadhaarBack) issues.push('Upload Aadhaar back');
  if (!uploadedDocs.passbook) issues.push('Upload bank passbook or cancelled cheque');
  if (panNumber.trim().length !== 10) issues.push('Enter your 10-character PAN');
  if (!gstDecisionValid(gstDecision)) issues.push(gstDecision.choice === 'assistance' ? 'Enter the GST assistance contact name and accept consent' : 'Complete your GST registration choice');
  return issues;
}
