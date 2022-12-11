const { v4 } = require('uuid');
const db = require('../connectors/postgres');
const { sendKafkaMessage } = require('../connectors/kafka');
const { validateTicketReservationDto } = require('../validation/reservation');
const messagesType = require('../constants/messages');
const router = require("express").Router();
const stripe = require("stripe")(process.env.STRIPE_KEY);

module.exports = (app) => {
  // Register HTTP endpoint to create new user
  app.post('/api/v1/reservation', async (req, res) => {
    // validate payload before proceeding with reservations
    const validationError = validateTicketReservationDto(req.body);
    if (validationError) {
      return res.status(403).send(validationError.message);
    }
    // Send message indicating ticket is pending checkout
    // so shop consumers can process message and call
    // sp-shop-api to decrement available ticket count
    await sendKafkaMessage(messagesType.TICKET_PENDING, {
      meta: { action: messagesType.TICKET_PENDING},
      body: { 
        matchNumber: req.body.matchNumber,
        tickets: req.body.tickets,
      }
    });

    // TODO: Perform Stripe Payment Flow
    router.post("/payment", (req, res) => {
      stripe.charges.create(
        {
          source: req.body.tokenId,
          amount: req.body.amount,
          currency: "egp",
        },
        (stripeErr, stripeRes) => {
          if (stripeErr) {
            res.status(500).json(stripeErr);
          } else {
            res.status(200).json(stripeRes);
          }
        }
      );
    });
    // TODO: Update master list to reflect ticket sale

    // Persist ticket sale in database with a generated reference id so user can lookup ticket
    const ticketReservation = { id: v4(), ...req.body };
    // const reservation = await db('reservations').insert(ticketReservation).returning('*');

    // Send message indicating ticket sale is final
    await sendKafkaMessage(messagesType.TICKET_RESERVED, {
      meta: { action: messagesType.TICKET_RESERVED},
      body: { 
        matchNumber: req.body.matchNumber,
        tickets: req.body.tickets,
      }
    });

    // Return success response to client
    return res.json({
      message: 'Ticket Purchase Successful',
      ...ticketReservation,
    });
  });
};