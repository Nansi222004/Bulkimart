import mongoose from "mongoose";

const { Schema, model } = mongoose;

const nhcPlanSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Plan name is required"],
      trim: true,
    },
    planType: {
      type: String,
      enum: ["UNIT_SELLER", "BLOCK_SELLER", "CUSTOM"],
      default: "UNIT_SELLER",
      required: true,
    },
    amount: {
      type: Number,
      required: [true, "Plan amount is required"],
      min: [0, "Amount cannot be negative"],
    },
    currency: {
      type: String,
      default: "INR",
    },
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  { timestamps: true }
);

const NHCPlan = model("NHCPlan", nhcPlanSchema);

/**
 * Ensures initial seed plans exist if collection is empty
 */
export const seedInitialNhcPlans = async () => {
  try {
    const count = await NHCPlan.countDocuments();
    if (count === 0) {
      await NHCPlan.create([
        {
          name: "Unit Seller",
          planType: "UNIT_SELLER",
          amount: 1000000,
          currency: "INR",
          description: "Standard NHC Unit Seller membership with local operational coverage.",
          isActive: true,
        },
        {
          name: "Block Seller",
          planType: "BLOCK_SELLER",
          amount: 1500000,
          currency: "INR",
          description: "Premium NHC Block Seller membership with expanded regional distribution.",
          isActive: true,
        },
      ]);
      console.log("[NHC PLAN SEED] Initial NHC plans created (Unit Seller: ₹10L, Block Seller: ₹15L)");
    }
  } catch (err) {
    console.error("[NHC PLAN SEED ERROR]", err);
  }
};

export default NHCPlan;
