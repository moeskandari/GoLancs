# importing psycopg2 module
import psycopg2
import xml.etree.ElementTree as ET

# establishing the connection
conn = psycopg2.connect(
    database="group1db",
    user='postgres',
    password='group1',
    host='localhost',
    port='5050'
)

# creating a cursor object
cursor = conn.cursor()



# Commit your changes in the database
conn.commit()

# Closing the connection
conn.close()