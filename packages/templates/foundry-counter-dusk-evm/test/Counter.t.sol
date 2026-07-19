// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Counter} from "../src/Counter.sol";

contract CounterTest {
    Counter private counter;

    function setUp() public {
        counter = new Counter();
    }

    function testInitialValueIsZero() public view {
        if (counter.number() != 0) revert("initial value should be zero");
    }

    function testSetNumber() public {
        counter.setNumber(42);
        if (counter.number() != 42) revert("setNumber failed");
    }

    function testIncrement() public {
        counter.increment();
        if (counter.number() != 1) revert("increment failed");
    }
}
