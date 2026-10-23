import crypto from 'node:crypto';
import { httpError } from '../utils/response.js';

export const destinationFingerprint = (details, required = true) => {
  const data = details?.toObject?.() || details || {};
  const parts = ['holderName', 'bankName', 'accountNo', 'ifsc', 'upiId'].map(key => String(data[key] || '').trim().toUpperCase());
  if (!parts[2] && !parts[4]) { if (required) throw httpError(409, 'Payout beneficiary destination is missing'); return null; }
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
};
export const payoutPublic = value => {
  const row = value?.toObject?.() || { ...value };
  const { bankDetails, ...safe } = row;
  return { ...safe, destination: { bankName: bankDetails?.bankName || '', accountLast4: String(bankDetails?.accountNo || '').slice(-4), upiPresent: Boolean(bankDetails?.upiId) }, transferMode: 'manual_external' };
};
// `requireIndependent` follows the admin finance policy (on by default): when
// set, the admin who checked the bank account cannot also confirm the transfer.
export const assertBeneficiaryReview = (payout, actorId, { requireIndependent = true } = {}) => {
  const proof = payout.beneficiaryVerification;
  if (!proof?.reviewedBy || !proof.verifiedAt || !proof.evidenceReference || !proof.approvalReference || proof.fingerprint !== destinationFingerprint(payout.bankDetails)) throw httpError(409, 'Beneficiary requires approved ownership verification for this exact destination');
  if (requireIndependent && String(proof.reviewedBy) === String(actorId)) throw httpError(409, 'An independent finance operator must confirm the external transfer');
};

export const approvedBeneficiaryProcess = async (connection, reference, session) => {
  const process = await connection.collection('finance_approved_processes').findOne({ _id: reference, kind: 'bank_beneficiary_verification', status: 'approved' }, { session });
  if (!process?.approvedBy || !process.approvalEvidenceReference || !process.version || !process.effectiveAt || new Date(process.effectiveAt) > new Date()
    || !Number.isFinite(new Date(process.effectiveAt).getTime()) || (process.expiresAt && !Number.isFinite(new Date(process.expiresAt).getTime()))
    || (process.expiresAt && new Date(process.expiresAt) <= new Date())) throw httpError(409, 'No approved beneficiary verification process is configured for this reference');
  if (!await connection.collection('admins').findOne({ _id: process.approvedBy, isActive: true, $or: [{ permissions: 'manage_finance' }, { role: 'superAdmin' }] }, { session, projection: { _id: 1 } })) throw httpError(409, 'Beneficiary process approval authority requires review');
  return process;
};
