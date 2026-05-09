async function fetchFiverrLeads(query) {

  return {
    success: true,
    leads: [
      {
        title: "Need Instagram marketing expert",
        budget: "$50",
        link: "https://fiverr.com/request1"
      },
      {
        title: "Looking for lead generation expert",
        budget: "$100",
        link: "https://fiverr.com/request2"
      }
    ]
  };
}

module.exports = fetchFiverrLeads;