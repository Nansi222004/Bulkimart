import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Policy from '../models/PrivacyPolicy.js';
import { getPolicyBySlug, updatePolicy } from '../controllers/privacyPolicyController.js';

const app=express();app.use(express.json());
// Controller tests isolate database behavior; production routes retain admin authentication.
app.use((req,_res,next)=>{req.user={_id:'507f1f77bcf86cd799439011'};next();});
app.get('/admin/privacy-policy/:identifier',getPolicyBySlug);
app.get('/privacy-policy/:slug',getPolicyBySlug);
app.put('/admin/privacy-policy/:identifier',updatePolicy);
let db;
const original={role:'user',slug:'user-policy',roleTitle:'Original customer policy',summary:'Original summary',version:'1.0.0',effectiveDate:'2026-01-01',sections:[{title:'Original section',content:'Original content'}]};
beforeAll(async()=>{db=await MongoMemoryServer.create({binary:{version:'7.0.14'}});await mongoose.connect(db.getUri());await Policy.init();});
beforeEach(async()=>{await Policy.deleteMany({});await Policy.create(original);});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
test('admin identifier and public slug both resolve the saved policy',async()=>{
  const admin=await request(app).get('/admin/privacy-policy/user-policy').expect(200);
  const publicRead=await request(app).get('/privacy-policy/user-policy').expect(200);
  expect(admin.body.data._id).toBe(publicRead.body.data._id);
});
test.each([
  [{roleTitle:''},'Policy title is required'],
  [{sections:[{title:'Terms',content:''}]},'Section 1: content is required'],
  [{sections:[{title:' ',content:'Body'}]},'Section 1: title is required'],
  [{effectiveDate:'2026-02-30'},'Enter a valid effective date'],
  [{version:''},'Policy version is required'],
  [{isPublished:'false'},'Published status must be true or false'],
])('invalid edit %j returns a useful 400 and preserves existing content',async(payload,message)=>{
  const r=await request(app).put('/admin/privacy-policy/user-policy').send(payload).expect(400);
  expect(r.body.message).toBe(message);expect((await Policy.findOne({role:'user'})).summary).toBe('Original summary');
});
test('publish persists reordered sections and public reads return the new content',async()=>{
  await request(app).put('/admin/privacy-policy/user-policy').send({...original,roleTitle:'Updated policy',sections:[{title:'Second first',content:'New content',order:2},{title:'First last',content:'More content',order:1}],isPublished:true}).expect(200);
  const r=await request(app).get('/privacy-policy/user-policy').expect(200);
  expect(r.body.data.roleTitle).toBe('Updated policy');expect(r.body.data.sections.map(s=>s.order)).toEqual([1,2]);
});
test('partial update keeps the title, effective date and publication state',async()=>{
  await Policy.updateOne({role:'user'},{$set:{isPublished:false}});
  await request(app).put('/admin/privacy-policy/user-policy').send({summary:'Changed summary'}).expect(200);
  const p=await Policy.findOne({role:'user'});expect(p.roleTitle).toBe(original.roleTitle);expect(p.effectiveDate.toISOString().slice(0,10)).toBe('2026-01-01');expect(p.isPublished).toBe(false);
});
