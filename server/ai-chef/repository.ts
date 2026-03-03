import { storage } from "../storage";
import type { AiChefIngredientDataSource } from "./types";

export const aiChefIngredientRepository: AiChefIngredientDataSource = {
  async getUserIngredients() {
    const all = await storage.getIngredients();
    return all.filter((item) => Boolean(item.alwaysAtHome));
  },
  async getAllIngredients() {
    return storage.getIngredients();
  },
};
