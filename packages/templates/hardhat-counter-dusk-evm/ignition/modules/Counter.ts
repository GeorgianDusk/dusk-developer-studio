import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("CounterModule", (module) => {
  const counter = module.contract("Counter");

  return { counter };
});
