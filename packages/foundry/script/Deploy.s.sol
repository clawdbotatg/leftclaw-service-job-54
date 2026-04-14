// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { DeployBurnJackpot } from "./DeployBurnJackpot.s.sol";

/// @notice Main deployment script — runs all deployments.
contract DeployScript is ScaffoldETHDeploy {
    function run() external {
        DeployBurnJackpot deployBurnJackpot = new DeployBurnJackpot();
        deployBurnJackpot.run();
    }
}
