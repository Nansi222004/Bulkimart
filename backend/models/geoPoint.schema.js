import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A GeoJSON point — the only shape MongoDB's 2dsphere index accepts.
 *
 * Declared as its own Schema, not as an inline object, and that distinction is
 * load-bearing. Written inline:
 *
 *   point: { type: { type: String, default: "Point" }, coordinates: [Number] }
 *
 * Mongoose treats it as a nested path and materialises the default on every new
 * document, so a record that has no location still gets `point: { type: "Point" }`
 * with no coordinates. A 2dsphere index then refuses the insert outright —
 * "Can't extract geo keys ... Point must be an array or object" — and `sparse`
 * does not save you, because the field genuinely exists; it is just incomplete.
 *
 * A single nested schema is only created when something is assigned to it, so a
 * document with no location has no `point` at all, which is exactly what a
 * sparse index wants.
 *
 * Coordinates are [longitude, latitude] — the reverse of how people say it.
 */
export const geoPointSchema = new Schema(
  {
    type:        { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: undefined },
  },
  { _id: false }
);

/** Build a point from human-ordered arguments, so callers cannot swap them. */
export const toGeoPoint = (lat, lng) =>
  lat === undefined || lng === undefined
    ? undefined
    : { type: "Point", coordinates: [lng, lat] };

export default geoPointSchema;
