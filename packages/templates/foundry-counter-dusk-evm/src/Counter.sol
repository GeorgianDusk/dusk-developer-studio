// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Counter
/// @notice Minimal example contract for DuskEVM Testnet onboarding.
/// @dev Example only. Unaudited and not production-ready.
contract Counter {
    uint256 public number;

    event NumberChanged(uint256 indexed newNumber);

    function setNumber(uint256 newNumber) external {
        number = newNumber;
        emit NumberChanged(newNumber);
    }

    function increment() external {
        number += 1;
        emit NumberChanged(number);
    }
}
