const msg = `
When subscribing a resource a single subscribe request request is sent and a single subscribe accept response is received.
When subscribing a resource a single listener is created on the server
When unsubscribing a resource the listener is deleted on the server
When a resource is set then it produces an event for each listener


GIVEN: A valid subscribable resource and one event is received
    THEN: Returns observable that produces a single value and does not complete
GIVEN: A valid subscribable resource and three events are received
    THEN: Returns observable that produces three values and does not complete
GIVEN: A valid subscribable resource and the resource is subscribed and then unsubscibed
    THEN: The correct unsubscribe request is made and no value produced on the observable
GIVEN: A valid subscribable resource and the resource is subscribed and then unsubscibed and the resubscribed and produces an event
    THEN: The correct unsubscribe request is made and then the correct subscribe request and the observable produces an event and does not close
GIVEN: A valid NON-subscribable resource
    THEN: Does not send any subscribe message and returns observable that produces an error explaining the problem
`;

export {};
