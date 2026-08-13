// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Counter} from "../contracts/Counter.sol";

contract CounterTest {
    Counter private counter;

    function setUp() public {
        counter = new Counter();
    }

    function testInitialValueIsZero() public view {
        require(counter.number() == 0, "initial value should be zero");
    }

    function testSetNumber() public {
        counter.setNumber(42);
        require(counter.number() == 42, "setNumber failed");
    }

    function testIncrement() public {
        counter.increment();
        require(counter.number() == 1, "increment failed");
    }
}
